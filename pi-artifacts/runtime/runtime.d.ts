/**
 * The artifact page runtime: what a published page can call. The agent reads
 * this file in its system prompt, so it is written for that reader too.
 *
 * A page has no network of its own. Its MCP calls go to the MCP connections
 * of the chat that published it, through the viewer page and the Worker. They
 * run as the chat's author, and only the (server, tool) pairs the page
 * declared at publish can be called.
 *
 *     const mcp = await pi.use("mcp");
 *     if (!mcp) return renderStatic();          // not framed by a viewer: no live data
 *     const stop = mcp.watchTool("CoinGecko", "execute", { code }, (ev) => {
 *       if (ev.type === "data") render(ev.result.payload, ev.result.cache?.storedAt);
 *       else showSectionError(ev.error);
 *     }, { refetchInterval: 30_000 });
 *
 *     const coins = await mcp.CoinGecko.search_docs({ query: "markets" }); // one-off, resolves to the payload
 */

interface Window {
  pi: Pi;
}
declare const pi: Pi;

interface Pi {
  /**
   * The capability's namespace, or `null` when this view cannot run it (the
   * page was opened outside a viewer, or the viewer never connected within
   * 10 s). Resolves after your script's first run: render first, then light
   * up live sections. Memoized. Any name other than "mcp" resolves `null`.
   */
  use(name: "mcp"): Promise<PiMcp | null>;
}

type PiMcpErrorCode =
  | "server_not_connected" // the chat has no server by that name
  | "server_unavailable" //   upstream down or slow; retryable
  | "auth_required" //        the page's author must sign in to this server in the app (it needs their own login)
  | "not_in_manifest" //      (server, tool) not declared at publish: a page bug
  | "not_granted" //          a write tool, or a server with private data, and the viewer is not the page's author
  | "tool_error" //           the tool ran and reported failure; `message` says why
  | "bad_request" //          bad arguments, or watchTool on a tool that is not read-only
  | "rate_limited" //         too many calls; wait `retryAfterMs`
  | "cancelled" //            the call's AbortSignal fired
  | "upstream_error"; //      anything else

/** Rejections and watch errors are Errors carrying these fields. Branch on `code`, never on `message`. */
interface PiMcpError extends Error {
  code: PiMcpErrorCode;
  server?: string;
  /** Present only as `true`: one retry after a short delay may succeed. Never loop. */
  retryable?: true;
  retryAfterMs?: number;
  /** The tool's own result envelope, on `tool_error`. */
  result?: unknown;
}

interface PiCallToolResult {
  content: ({ type: "text"; text: string } | { type: string; [k: string]: unknown })[];
  structuredContent?: unknown;
  /**
   * The JSON answer: `structuredContent`, else the first text block parsed as
   * JSON, else that text. Read this rather than `content`.
   */
  payload?: unknown;
  /**
   * Present when served from a cache. `storedAt` (epoch ms) is when the data
   * was produced: drive "updated N s ago" labels from it, not from Date.now().
   * `revalidating: true` on a watch replay whose refresh is already in flight.
   */
  cache?: { storedAt: number; revalidating: boolean };
}

type PiWatchEvent = { type: "data"; result: PiCallToolResult } | { type: "error"; error: PiMcpError };

interface PiMcp {
  /**
   * DISPLAY data that should stay current. Replays the last result at once
   * (marked with `cache`), fetches when it is missing or stale, then delivers
   * every newer result. `refetchInterval` (ms, floor 30 000) polls; polling
   * pauses while the viewer's tab is hidden and catches up when it returns.
   * Identical watches share one request. Read-only tools only.
   *
   * Returns a synchronous unsubscribe. Every failure arrives on the handler
   * as an `error` event: keep last-good data on `server_unavailable`,
   * `rate_limited` and `tool_error`; clear it on `not_in_manifest` and
   * `server_not_connected`.
   */
  watchTool(
    server: string,
    tool: string,
    input: unknown,
    handler: (event: PiWatchEvent) => void,
    options?: { refetchInterval?: number; cache?: { staleTime?: number } },
  ): () => void;

  /**
   * ACTIONS, or a one-off read. Resolves with the result, rejects with a
   * PiMcpError. `cache.staleTime` lets a read reuse a result that young (ms);
   * `cache.refresh` forces a fresh one. Write tools (not read-only) run only
   * for the page's author and are never cached.
   */
  callTool(
    server: string,
    tool: string,
    input?: unknown,
    options?: { cache?: false | { staleTime?: number; refresh?: boolean }; signal?: AbortSignal },
  ): Promise<PiCallToolResult>;

  /** Drop cached results and refetch matching watches; call after a write. Narrow by server, tool, exact input. */
  invalidate(server?: string, tool?: string, input?: unknown): Promise<void>;

  /** The servers and tools this page declared. Never asks anything. */
  listTools(server?: string): Promise<{ servers: { server: string; kind: "connector"; authStatus: "connected"; tools: { name: string; description: string }[] }[] }>;

  /** One tool's description and input JSON Schema. */
  describeTool(server: string, tool: string): Promise<{ name: string; description: string; inputSchema: unknown; annotations?: { readOnlyHint?: boolean } }>;

  /** A handle whose methods are one server's declared tools; each resolves to the call's `payload`. */
  server(name: string): Promise<Readonly<Record<string, (input?: unknown) => Promise<unknown>>>>;

  /**
   * The same handles as properties, one per declared server:
   * `await mcp.CoinGecko.execute({ code })` resolves to the payload.
   */
  readonly [server: string]: unknown;
}
