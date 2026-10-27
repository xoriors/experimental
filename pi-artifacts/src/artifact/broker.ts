import { canonicalJson } from "../../shared/canonical.ts";
import { MIN_REFETCH_MS, type CallToolResult, type McpError, type ProxyRequest, type ProxyResponse, type ToolInfo } from "../../shared/protocol.ts";

/** Sends one proxied call to the Worker. Swappable in tests. */
export type Transport = (request: ProxyRequest) => Promise<ProxyResponse>;

export interface BrokerOptions {
  artifactId: string;
  version: number;
  transport: Transport;
  describe: () => Promise<ToolInfo[]>;
  /** Browser cache namespace; include the viewer so accounts on one browser never share results. */
  cacheNamespace: string;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> | null;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

type WatchEvent = { type: "data"; result: CallToolResult } | { type: "error"; error: McpError };

interface Cached {
  result: CallToolResult;
  storedAt: number;
}

interface Group {
  key: string;
  server: string;
  tool: string;
  input: unknown;
  subscribers: Map<number, { interval?: number; staleTime?: number }>;
  last?: Cached;
  nextAt?: number;
  timer?: unknown;
  inflight: boolean;
  retried: boolean;
  stopped: boolean;
}

const CACHE_LIFETIME_MS = 10 * 60_000;
/** Errors no refetch can fix: stop polling and drop the data. */
const DENIALS = new Set(["not_in_manifest", "server_not_connected", "not_granted", "bad_request"]);

/**
 * The viewer-side half of the page runtime: it owns the iframe's MessagePort,
 * sends calls to the Worker and keeps watches current.
 *
 * Polling follows the server's hint: each response says when its result goes
 * stale (`nextRefreshAt`), and the next poll goes out just after that, so a
 * viewer sees a new upstream result within about a second of the Durable
 * Object fetching it.
 */
export class ArtifactBroker {
  readonly #o: Required<Omit<BrokerOptions, "storage">> & { storage: BrokerOptions["storage"] };
  readonly #groups = new Map<string, Group>();
  readonly #watchGroup = new Map<number, Group>();
  #port: MessagePort | undefined;
  #hidden = false;
  #closed = false;

  constructor(options: BrokerOptions) {
    this.#o = {
      now: Date.now,
      random: Math.random,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (timer) => clearTimeout(timer as number),
      storage: null,
      ...options,
    };
  }

  /** Take the port whose other end was handed to the page. */
  connect(port: MessagePort): void {
    this.#port = port;
    port.onmessage = (event: MessageEvent) => this.#onMessage(event.data);
  }

  /** Pause polling while the viewer cannot see the page; catch up when it comes back. */
  setHidden(hidden: boolean): void {
    if (this.#hidden === hidden) return;
    this.#hidden = hidden;
    for (const group of this.#groups.values()) {
      if (hidden) this.#clearTimer(group);
      else this.#schedule(group);
    }
  }

  close(): void {
    this.#closed = true;
    for (const group of this.#groups.values()) this.#clearTimer(group);
    this.#groups.clear();
    this.#watchGroup.clear();
    this.#port?.close();
  }

  #onMessage(message: any): void {
    if (!message || this.#closed) return;
    if (message.type === "request") void this.#onRequest(message.id, message.method, message.params ?? {});
    else if (message.type === "watch") this.#watch(message);
    else if (message.type === "unwatch") this.#unwatch(message.watchId);
  }

  async #onRequest(id: number, method: string, params: any): Promise<void> {
    const reply = (ok: boolean, payload: unknown) => this.#port?.postMessage(ok ? { type: "reply", id, ok, value: payload } : { type: "reply", id, ok, error: payload });
    try {
      if (method === "call") {
        const cache = params.cache;
        const read = cache !== false && cache !== undefined && typeof cache === "object";
        const staleMs = read ? (cache.refresh ? 0 : Math.max(0, Number(cache.staleTime) || 0)) : 0;
        const response = await this.#send({ mode: read ? "read" : "call", server: params.server, tool: params.tool, input: params.input, staleMs });
        if (!response.ok) return reply(false, response.error);
        if (read) this.#feed(identity(params.server, params.tool, params.input), response);
        reply(true, response.result);
      } else if (method === "invalidate") {
        this.#invalidate(params.server, params.tool, params.input);
        reply(true, undefined);
      } else if (method === "describe") {
        const tools = await this.#o.describe();
        const tool = tools.find((t) => t.name === params.tool);
        if (!tool) return reply(false, { code: "not_in_manifest", server: params.server, message: `${params.server}/${params.tool} is not declared by this page.` });
        reply(true, { name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations });
      } else {
        reply(false, { code: "bad_request", message: `Unknown method ${method}` });
      }
    } catch (error) {
      reply(false, { code: "upstream_error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  #watch(message: { watchId: number; server: string; tool: string; input: unknown; refetchInterval?: number; staleTime?: number }): void {
    const key = identity(message.server, message.tool, message.input);
    let group = this.#groups.get(key);
    if (!group) {
      group = { key, server: message.server, tool: message.tool, input: message.input, subscribers: new Map(), inflight: false, retried: false, stopped: false };
      group.last = this.#readStorage(key);
      this.#groups.set(key, group);
    }
    const interval = message.refetchInterval ? Math.max(Number(message.refetchInterval) || 0, MIN_REFETCH_MS) : undefined;
    group.subscribers.set(message.watchId, { interval, staleTime: message.staleTime });
    this.#watchGroup.set(message.watchId, group);

    const stale = !group.last || this.#o.now() - group.last.storedAt >= this.#staleMs(group);
    if (group.last) this.#deliverTo(message.watchId, { type: "data", result: withCache(group.last, stale) });
    if (group.stopped) return;
    if (stale && !group.inflight) void this.#fetch(group);
    else this.#schedule(group);
  }

  #unwatch(watchId: number): void {
    const group = this.#watchGroup.get(watchId);
    this.#watchGroup.delete(watchId);
    if (!group) return;
    group.subscribers.delete(watchId);
    if (group.subscribers.size === 0) {
      this.#clearTimer(group);
      this.#groups.delete(group.key);
    }
  }

  /** The shortest interval any subscriber asked for. */
  #interval(group: Group): number | undefined {
    const intervals = [...group.subscribers.values()].map((s) => s.interval).filter((i): i is number => i !== undefined);
    return intervals.length ? Math.min(...intervals) : undefined;
  }

  /** How young a result must be to skip a fetch: the declared staleTime, else the polling interval. */
  #staleMs(group: Group): number {
    const staleTimes = [...group.subscribers.values()].map((s) => s.staleTime).filter((t): t is number => typeof t === "number");
    return staleTimes.length ? Math.min(...staleTimes) : (this.#interval(group) ?? 0);
  }

  async #fetch(group: Group, staleOverride?: number): Promise<void> {
    if (this.#closed || group.inflight) return;
    this.#clearTimer(group);
    group.inflight = true;
    const response = await this.#send({ mode: "read", server: group.server, tool: group.tool, input: group.input, staleMs: staleOverride ?? this.#staleMs(group) });
    group.inflight = false;
    if (this.#closed || !this.#groups.has(group.key)) return;

    if (response.ok) {
      group.retried = false;
      this.#feed(group.key, response);
      return;
    }
    const error = response.error;
    this.#deliver(group, { type: "error", error });
    if (DENIALS.has(error.code)) {
      group.last = undefined;
      group.stopped = true;
      this.#removeStorage(group.key);
      return;
    }
    const interval = this.#interval(group);
    if (error.retryable && !group.retried) {
      group.retried = true;
      group.nextAt = this.#o.now() + (error.retryAfterMs ?? 2_000 + this.#o.random() * 3_000);
    } else {
      group.retried = false;
      group.nextAt = interval ? this.#o.now() + interval : undefined;
    }
    this.#schedule(group);
  }

  /** A fresh result for an identity: store it, deliver it, and plan the next poll from the server's hint. */
  #feed(key: string, response: Extract<ProxyResponse, { ok: true }>): void {
    const group = this.#groups.get(key);
    const cached = { result: stripCache(response.result), storedAt: response.storedAt };
    this.#writeStorage(key, cached);
    if (!group) return;
    group.last = cached;
    this.#deliver(group, { type: "data", result: response.result });
    const interval = this.#interval(group);
    if (!interval) {
      group.nextAt = undefined;
    } else {
      // Ask again just after the server's copy goes stale; never sooner than a second from now.
      const due = response.nextRefreshAt ?? response.storedAt + interval;
      group.nextAt = Math.max(due, this.#o.now() + 1_000) + 250 + this.#o.random() * 1_000;
    }
    this.#schedule(group);
  }

  #schedule(group: Group): void {
    this.#clearTimer(group);
    if (this.#hidden || this.#closed || group.stopped || group.nextAt === undefined) return;
    const delay = Math.max(0, group.nextAt - this.#o.now());
    group.timer = this.#o.setTimer(() => {
      group.timer = undefined;
      void this.#fetch(group);
    }, delay);
  }

  #clearTimer(group: Group): void {
    if (group.timer !== undefined) this.#o.clearTimer(group.timer);
    group.timer = undefined;
  }

  #invalidate(server?: string, tool?: string, input?: unknown): void {
    const exact = input !== undefined && server !== undefined && tool !== undefined ? identity(server, tool, input) : undefined;
    const matches = (key: string, g: { server: string; tool: string }) =>
      exact ? key === exact : (server === undefined || g.server === server) && (tool === undefined || g.tool === tool);
    const storage = this.#o.storage;
    if (storage) {
      const prefix = this.#storagePrefix();
      const doomed: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (!k?.startsWith(prefix)) continue;
        const [s, t] = k.slice(prefix.length).split("\u0000");
        if (matches(k.slice(prefix.length), { server: s, tool: t })) doomed.push(k);
      }
      for (const k of doomed) storage.removeItem(k);
    }
    for (const group of this.#groups.values()) {
      if (!matches(group.key, group)) continue;
      group.stopped = false;
      void this.#fetch(group, 0);
    }
  }

  async #send(call: Omit<ProxyRequest, "version">): Promise<ProxyResponse> {
    try {
      return await this.#o.transport({ ...call, version: this.#o.version });
    } catch (error) {
      return { ok: false, error: { code: "server_unavailable", retryable: true, message: error instanceof Error ? error.message : String(error) } };
    }
  }

  #deliver(group: Group, event: WatchEvent): void {
    for (const watchId of group.subscribers.keys()) this.#deliverTo(watchId, event);
  }

  #deliverTo(watchId: number, event: WatchEvent): void {
    this.#port?.postMessage({ type: "watch", watchId, event });
  }

  #storagePrefix(): string {
    return `pi-cache:${this.#o.cacheNamespace}:${this.#o.artifactId}:`;
  }

  #readStorage(key: string): Cached | undefined {
    try {
      const raw = this.#o.storage?.getItem(this.#storagePrefix() + key);
      if (!raw) return undefined;
      const cached = JSON.parse(raw) as Cached;
      return this.#o.now() - cached.storedAt < CACHE_LIFETIME_MS ? cached : undefined;
    } catch {
      return undefined;
    }
  }

  #writeStorage(key: string, cached: Cached): void {
    try {
      this.#o.storage?.setItem(this.#storagePrefix() + key, JSON.stringify(cached));
    } catch {
      // Full or unavailable storage only costs the instant replay on the next visit.
    }
  }

  #removeStorage(key: string): void {
    try {
      this.#o.storage?.removeItem(this.#storagePrefix() + key);
    } catch {}
  }
}

export function identity(server: string, tool: string, input: unknown): string {
  return `${server}\u0000${tool}\u0000${canonicalJson(input ?? {})}`;
}

function stripCache(result: CallToolResult): CallToolResult {
  const { cache: _cache, ...rest } = result;
  return rest;
}

function withCache(cached: Cached, revalidating: boolean): CallToolResult {
  return { ...cached.result, cache: { storedAt: cached.storedAt, revalidating } };
}
