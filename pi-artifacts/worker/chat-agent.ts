import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type AgentEventStream } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle, type DurableObjectCapability } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";
import { DurableObject, exports } from "cloudflare:workers";
import type { ArtifactManifest, ChatClientMessage, ChatServerMessage, McpError, ProxyRequest, ProxyResponse, ToolInfo } from "../shared/protocol.ts";
import { promptExtension } from "./agent/prompt.ts";
import { artifactExtension, filesExtension, mcpExtension, publishArtifact, sandboxExtension, type ChatScope, type ServerCatalog } from "./agent/tools.ts";
import { Storage } from "./storage/index.ts";
import { connectStreamableHttp, signInRequired } from "./mcp/connect.ts";
import { McpOAuthClient } from "./mcp/oauth.ts";
import { McpFailure, McpHub } from "./mcp/hub.ts";
import { mcpServers, type McpServerConfig } from "./mcp/servers.ts";
import { mcpAuthStore } from "./users.ts";

const SOCKET_TAG = "chat";
const MAX_STALE_MS = 24 * 60 * 60_000;
const CALLS_PER_MINUTE = 120;

export interface ArtifactCall {
  artifactId: string;
  viewer: string;
  request: ProxyRequest;
}

/**
 * One chat: its Pi agent, its MCP connections, and the live calls of the
 * artifacts it published. Named `<uid>:<chatId>`.
 *
 * An artifact's page calls MCP tools through `artifactCall`, which uses the
 * same McpHub as the agent's tools. No model is involved in those calls.
 */
export class ChatAgent extends DurableObject<Env> {
  readonly hub = new McpHub(mcpServers(this.env), (server) => this.#connect(server));
  readonly storage = new Storage(this.env);
  readonly ai = createAI({ binding: this.env.AI, gateway: this.env.AI_GATEWAY_ID, byokAlias: this.env.AI_BYOK_ALIAS || undefined });
  readonly registry = createRegistry();
  readonly harness = new PiHarness({
    harness: ({ storage, context, onWake }) => {
      const models = createModels();
      models.setProvider(this.ai.provider);
      return Harness.open(storage, { models, registry: this.registry, onWake }, context);
    },
    // Current Claude models reject pi's "off" (thinking: disabled), so new chats think at medium effort.
    defaults: { model: this.ai(this.env.MODEL), thinkingLevel: "medium" },
  });
  readonly sockets = new ChatSockets(this);
  readonly lifecycle = Lifecycle.install(this).use(this.harness).use(this.sockets);

  readonly scope: ChatScope;
  readonly #manifests = new Map<string, ArtifactManifest>();
  readonly #rate = new Map<string, { windowStart: number; count: number }>();
  #mcpRefresh: Promise<void> | undefined;
  /** The servers whose tools the agent has now, so a refresh reinstalls only on a change. */
  #mcpInstalled = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const scope: ChatScope = (this.scope = {
      uid: this.uid,
      chatId: this.chatId,
      hub: this.hub,
      artifacts: this.storage.artifacts,
      // The uid is this object's name, which the Worker sets from a verified identity.
      files: () => this.storage.userFiles(this.uid),
      onPublished: (artifact) => exports.UserDirectory.getByName(this.uid).recordArtifact({ ...artifact, chatId: this.chatId }),
    });
    this.registry.install(promptExtension);
    this.registry.install(artifactExtension(scope));
    this.registry.install(filesExtension(scope));
    if (env.SANDBOX_ENABLED === "true") this.registry.install(sandboxExtension(scope));
  }

  get uid(): string {
    return this.ctx.id.name!.split(":")[0];
  }

  get chatId(): string {
    return this.ctx.id.name!.split(":")[1];
  }

  /** Called by Lifecycle once capabilities have started, including after an eviction. */
  onStart(): void {
    void this.refreshMcpTools();
  }

  /**
   * List each MCP server's tools and install them as agent tools. Runs before
   * every prompt: tool lists are cached, and a server the user has signed in
   * to since (or whose sign-in expired) joins or leaves then.
   */
  refreshMcpTools(): Promise<void> {
    this.#mcpRefresh ??= (async () => {
      const catalog = new Map<string, ServerCatalog>();
      const unavailable = new Map<string, string>();
      for (const server of this.hub.servers()) {
        try {
          catalog.set(server.name, { tools: await this.hub.tools(server.name), instructions: await this.hub.instructions(server.name) });
        } catch (error) {
          unavailable.set(server.name, error instanceof McpFailure ? error.error.message : String(error));
        }
      }
      const installed = JSON.stringify([[...catalog.keys()], [...unavailable.keys()]]);
      if (installed !== this.#mcpInstalled) {
        this.registry.install(mcpExtension(this.hub, catalog, unavailable));
        this.#mcpInstalled = installed;
      }
    })().finally(() => {
      this.#mcpRefresh = undefined;
    });
    return this.#mcpRefresh;
  }

  /** Public servers connect as they are; a server with `auth: "oauth"` connects with this chat's user's own tokens. */
  async #connect(server: McpServerConfig) {
    if (server.auth !== "oauth") return connectStreamableHttp(server);
    const store = mcpAuthStore(this.uid, server.name);
    const { tokens, redirectUrl } = await store.get();
    const signInUrl = await this.#signInUrl(server.name);
    if (!tokens || !redirectUrl) throw signInRequired(server.name, signInUrl);
    return connectStreamableHttp(server, new McpOAuthClient(store, server.name, { redirectUrl, interactive: false }), { signInUrl });
  }

  /** The app's address, from the chat's own WebSocket request: sign-in links in messages must be absolute. */
  async rememberOrigin(origin: string): Promise<void> {
    if (origin !== (await this.ctx.storage.get<string>("origin"))) await this.ctx.storage.put("origin", origin);
  }

  async #signInUrl(server: string): Promise<string | undefined> {
    const origin = await this.ctx.storage.get<string>("origin");
    return origin ? `${origin}/api/mcp/sign-in/${encodeURIComponent(server)}` : undefined;
  }

  async prompt(text: string): Promise<void> {
    await this.refreshMcpTools().catch(() => {});
    const first = (await this.harness.messages()).length === 0;
    await this.harness.submit(text);
    await exports.UserDirectory.getByName(this.uid).touchChat(this.chatId, first ? text : undefined);
  }

  /** Publish without the model, through the same checks as the agent's tool. Only routed when DEV_TOOLS is on. */
  async devPublish(input: { title: string; html: string; artifactId?: string; mcp?: { server: string; tools: string[] }[]; message?: string }) {
    const meta = await publishArtifact(this.scope, input);
    return { artifactId: meta.id, version: meta.latest };
  }

  async abort(): Promise<void> {
    await this.harness.abort();
  }

  /** The tools an artifact version declared, with their schemas: what the page's describeTool reads. */
  async artifactTools(artifactId: string, version: number): Promise<ToolInfo[] | McpError> {
    const manifest = await this.#manifest(artifactId, version);
    if (!manifest) return { code: "not_in_manifest", message: "No such artifact version in this chat." };
    const tools: ToolInfo[] = [];
    for (const entry of manifest.mcp?.servers ?? []) {
      for (const tool of await this.hub.tools(entry.server).catch(() => [])) {
        if (entry.tools.includes(tool.name)) tools.push(tool);
      }
    }
    return tools;
  }

  /** One MCP call from a published page. The Worker has already resolved the viewer. */
  async artifactCall({ artifactId, viewer, request }: ArtifactCall): Promise<ProxyResponse> {
    const fail = (error: McpError): ProxyResponse => ({ ok: false, error });
    const { server, tool, input, mode } = request;

    const limited = this.#rateLimit(viewer);
    if (limited) return fail({ code: "rate_limited", message: "Too many calls from this page.", retryAfterMs: limited });

    const manifest = await this.#manifest(artifactId, request.version);
    if (!manifest) return fail({ code: "not_in_manifest", server, message: "No such artifact version in this chat." });
    const declared = manifest.mcp?.servers.find((entry) => entry.server === server);
    if (!declared?.tools.includes(tool)) {
      return fail({ code: "not_in_manifest", server, message: `This page did not declare ${server}/${tool} when it was published.` });
    }

    // A page calls as its author. For a server that signs in each user, that would show the author's data to anyone with the link.
    if (this.hub.servers().find((s) => s.name === server)?.auth === "oauth" && viewer !== this.uid) {
      return fail({ code: "not_granted", server, message: `${server} signs in each user, and this page calls as its author, so only the author can load it.` });
    }

    try {
      const info = await this.hub.tool(server, tool);
      if (!info) return fail({ code: "not_in_manifest", server, message: `${server} no longer has a tool named ${tool}.` });
      const readOnly = info.annotations?.readOnlyHint === true;

      if (mode === "read") {
        if (!readOnly) return fail({ code: "bad_request", server, message: `${tool} is not read-only, so it cannot be watched or cached; use callTool.` });
        const staleMs = Math.min(Math.max(Number(request.staleMs) || 0, 0), MAX_STALE_MS);
        const read = await this.hub.read(server, tool, input, { staleMs, viewer });
        return { ok: true, result: read.result, storedAt: read.storedAt, nextRefreshAt: staleMs > 0 ? read.nextRefreshAt : undefined };
      }

      if (!readOnly && viewer !== this.uid) {
        return fail({ code: "not_granted", server, message: `${tool} can change data, so only the page's author can call it.` });
      }
      const result = await this.hub.call(server, tool, input);
      return { ok: true, result, storedAt: Date.now() };
    } catch (error) {
      if (error instanceof McpFailure) return fail(error.error);
      return fail({ code: "upstream_error", server, message: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Versions never change once published, so their manifests cache for the object's lifetime. */
  async #manifest(artifactId: string, version: number): Promise<ArtifactManifest | undefined> {
    const key = `${artifactId}:${version}`;
    let manifest = this.#manifests.get(key);
    if (!manifest) {
      const meta = await this.storage.artifacts.readMeta(artifactId);
      if (!meta || meta.chatId !== this.chatId || meta.ownerUid !== this.uid) return undefined;
      manifest = meta.versions.find((v) => v.version === version)?.manifest;
      if (!manifest) return undefined;
      this.#manifests.set(key, manifest);
    }
    return manifest;
  }

  /** A fixed one-minute window per viewer. Returns the ms to wait when over the limit. */
  #rateLimit(viewer: string): number | undefined {
    const now = Date.now();
    if (this.#rate.size > 1_000) {
      for (const [key, window] of this.#rate) if (now - window.windowStart >= 60_000) this.#rate.delete(key);
    }
    const entry = this.#rate.get(viewer);
    if (!entry || now - entry.windowStart >= 60_000) {
      this.#rate.set(viewer, { windowStart: now, count: 1 });
      return undefined;
    }
    entry.count++;
    return entry.count > CALLS_PER_MINUTE ? entry.windowStart + 60_000 - now : undefined;
  }
}

/**
 * The chat's browser connections. Each socket gets its own pi event stream:
 * a snapshot of the conversation first, then one batch per commit. Sockets
 * hibernate; after the object restarts, streams are reattached in onStart.
 */
class ChatSockets implements DurableObjectCapability {
  readonly #host: ChatAgent;
  readonly #streams = new Map<WebSocket, Promise<AgentEventStream>>();

  constructor(host: ChatAgent) {
    this.#host = host;
  }

  get #ctx(): DurableObjectState {
    return (this.#host as unknown as { ctx: DurableObjectState }).ctx;
  }

  onStart(): void {
    for (const ws of this.#ctx.getWebSockets(SOCKET_TAG)) void this.#attach(ws);
  }

  onWebSocketUpgrade({ request }: { request: Request }): Response | undefined {
    if (!new URL(request.url).pathname.endsWith("/ws")) return undefined;
    void this.#host.rememberOrigin(new URL(request.url).origin);
    const pair = new WebSocketPair();
    this.#ctx.acceptWebSocket(pair[1], [SOCKET_TAG]);
    void this.#attach(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async onWebSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<boolean> {
    if (!this.#ctx.getTags(ws).includes(SOCKET_TAG)) return false;
    void this.#attach(ws);
    let message: ChatClientMessage;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return true;
    }
    try {
      if (message.type === "prompt" && message.text.trim()) await this.#host.prompt(message.text.slice(0, 20_000));
      else if (message.type === "abort") await this.#host.abort();
    } catch (error) {
      send(ws, { type: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  async onWebSocketClose(ws: WebSocket): Promise<boolean> {
    if (!this.#ctx.getTags(ws).includes(SOCKET_TAG)) return false;
    await this.#detach(ws);
    return true;
  }

  async onWebSocketError(ws: WebSocket): Promise<boolean> {
    return this.onWebSocketClose(ws);
  }

  #attach(ws: WebSocket): Promise<AgentEventStream> {
    let stream = this.#streams.get(ws);
    if (stream) return stream;
    stream = (async () => {
      const events = await this.#host.harness.session().events();
      send(ws, { type: "events", events: [events.snapshot] });
      events.start(async (batch) => {
        if (!send(ws, { type: "events", events: [...batch] })) await this.#detach(ws);
      });
      return events;
    })();
    this.#streams.set(ws, stream);
    stream.catch((error) => {
      this.#streams.delete(ws);
      send(ws, { type: "error", message: `Could not open the conversation: ${error instanceof Error ? error.message : String(error)}` });
    });
    return stream;
  }

  async #detach(ws: WebSocket): Promise<void> {
    const stream = this.#streams.get(ws);
    this.#streams.delete(ws);
    if (stream) await (await stream.catch(() => undefined))?.stop();
  }
}

function send(ws: WebSocket, message: ChatServerMessage): boolean {
  try {
    ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}
