import type { CallToolResult, McpError, ToolInfo } from "../../shared/protocol.ts";
import { canonicalJson, derivePayload } from "../../shared/canonical.ts";
import type { McpServerConfig } from "./servers.ts";

/** A tool result as an MCP server returns it. */
export interface RawToolResult {
  content: CallToolResult["content"];
  structuredContent?: unknown;
  isError?: boolean;
}

/** One open MCP session. The real one wraps the MCP SDK client (see connect.ts); tests pass fakes. */
export interface McpConnection {
  /** The server's own description of itself, from the MCP handshake. */
  instructions?: string;
  listTools(): Promise<ToolInfo[]>;
  callTool(name: string, args: unknown): Promise<RawToolResult>;
  close(): Promise<void>;
}

export type Connector = (server: McpServerConfig) => Promise<McpConnection>;

/** Thrown by the hub with a code the page runtime understands. */
export class McpFailure extends Error {
  constructor(readonly error: McpError) {
    super(error.message);
  }
}

export interface ReadResult {
  result: CallToolResult;
  /** When the result was produced upstream (epoch ms). */
  storedAt: number;
  /** When a fresh result is next worth asking for: the server hint pages poll by. */
  nextRefreshAt: number;
}

interface CacheEntry {
  result: CallToolResult;
  storedAt: number;
}

const MAX_CACHE_ENTRIES = 500;
const CACHE_LIFETIME_MS = 10 * 60_000;

/**
 * The chat's MCP connections. Pi's tools and artifact pages call through the
 * same hub, so a page reaches exactly the servers the agent used to build it.
 *
 * Reads go through `read()`, which caches successful results and lets
 * concurrent identical calls share one upstream request. Writes go through
 * `call()` and are never cached.
 */
export class McpHub {
  readonly #connector: Connector;
  readonly #now: () => number;
  readonly #servers = new Map<string, McpServerConfig>();
  readonly #connections = new Map<string, Promise<McpConnection>>();
  readonly #tools = new Map<string, Promise<ToolInfo[]>>();
  readonly #cache = new Map<string, CacheEntry>();
  readonly #inflight = new Map<string, Promise<CacheEntry>>();

  constructor(servers: McpServerConfig[], connector: Connector, now: () => number = Date.now) {
    for (const server of servers) this.#servers.set(server.name, server);
    this.#connector = connector;
    this.#now = now;
  }

  servers(): McpServerConfig[] {
    return [...this.#servers.values()];
  }

  async tools(server: string): Promise<ToolInfo[]> {
    let tools = this.#tools.get(server);
    if (!tools) {
      tools = this.#withConnection(server, (connection) => connection.listTools());
      this.#tools.set(server, tools);
      tools.catch(() => this.#tools.delete(server));
    }
    return tools;
  }

  /** What the server says about itself when it connects (MCP `instructions`), if anything. */
  async instructions(server: string): Promise<string | undefined> {
    return this.#withConnection(server, async (connection) => connection.instructions);
  }

  async tool(server: string, name: string): Promise<ToolInfo | undefined> {
    return (await this.tools(server)).find((tool) => tool.name === name);
  }

  /** Execute a tool once, uncached. Rejects with McpFailure. */
  async call(server: string, tool: string, input: unknown): Promise<CallToolResult> {
    const raw = await this.#withConnection(server, (connection) => connection.callTool(tool, input ?? {}));
    if (raw.isError) {
      const text = raw.content.find((block) => block.type === "text") as { text?: string } | undefined;
      throw new McpFailure({ code: "tool_error", server, message: text?.text ?? "The tool reported an error.", result: raw });
    }
    const result: CallToolResult = { content: raw.content };
    if (raw.structuredContent !== undefined) result.structuredContent = raw.structuredContent;
    result.payload = derivePayload(raw as Parameters<typeof derivePayload>[0]);
    return result;
  }

  /**
   * A read-only call through the cache. Serves an entry younger than
   * `staleMs`, otherwise executes; identical calls in flight share one
   * execution. `viewer` keys the cache unless the server's scope is shared.
   */
  async read(server: string, tool: string, input: unknown, options: { staleMs: number; viewer: string }): Promise<ReadResult> {
    const config = this.#config(server);
    const scope = config.cacheScope === "shared" ? "*" : options.viewer;
    const key = `${scope}\u0000${server}\u0000${tool}\u0000${canonicalJson(input ?? {})}`;
    const now = this.#now();

    const hit = this.#cache.get(key);
    if (hit && now - hit.storedAt < options.staleMs) {
      return {
        result: { ...hit.result, cache: { storedAt: hit.storedAt, revalidating: false } },
        storedAt: hit.storedAt,
        nextRefreshAt: hit.storedAt + options.staleMs,
      };
    }

    let flight = this.#inflight.get(key);
    if (!flight) {
      flight = this.call(server, tool, input).then((result) => {
        const entry = { result, storedAt: this.#now() };
        this.#store(key, entry);
        return entry;
      });
      this.#inflight.set(key, flight);
      const settle = () => this.#inflight.delete(key);
      flight.then(settle, settle);
    }
    const entry = await flight;
    return { result: entry.result, storedAt: entry.storedAt, nextRefreshAt: entry.storedAt + options.staleMs };
  }

  async close(): Promise<void> {
    const connections = [...this.#connections.values()];
    this.#connections.clear();
    await Promise.allSettled(connections.map(async (connection) => (await connection).close()));
  }

  #config(server: string): McpServerConfig {
    const config = this.#servers.get(server);
    if (!config) throw new McpFailure({ code: "server_not_connected", server, message: `No MCP server named "${server}" is connected to this chat.` });
    return config;
  }

  #store(key: string, entry: CacheEntry): void {
    const now = this.#now();
    for (const [k, e] of this.#cache) {
      if (now - e.storedAt > CACHE_LIFETIME_MS) this.#cache.delete(k);
    }
    this.#cache.delete(key);
    this.#cache.set(key, entry);
    while (this.#cache.size > MAX_CACHE_ENTRIES) {
      this.#cache.delete(this.#cache.keys().next().value!);
    }
  }

  /**
   * Run `fn` on the server's connection. A failure that is not the tool's own
   * answer drops the connection (its MCP session may have expired) and tries
   * once more on a fresh one.
   */
  async #withConnection<T>(server: string, fn: (connection: McpConnection) => Promise<T>): Promise<T> {
    const config = this.#config(server);
    for (let attempt = 0; ; attempt++) {
      const connection = this.#connect(config);
      try {
        return await fn(await connection);
      } catch (error) {
        const signIn = error instanceof McpFailure && error.error.code === "auth_required";
        // A connection that needs a sign-in is dropped, so the next call after signing in connects afresh.
        if (signIn && this.#connections.get(server) === connection) this.#connections.delete(server);
        if (error instanceof McpFailure) throw error;
        if (this.#connections.get(server) === connection) this.#connections.delete(server);
        connection.then((c) => c.close()).catch(() => {});
        if (attempt === 0) continue;
        throw new McpFailure({
          code: "server_unavailable",
          server,
          retryable: true,
          message: `${server} did not answer: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  #connect(config: McpServerConfig): Promise<McpConnection> {
    let connection = this.#connections.get(config.name);
    if (!connection) {
      connection = this.#connector(config);
      this.#connections.set(config.name, connection);
    }
    return connection;
  }
}
