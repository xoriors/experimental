export interface McpServerConfig {
  /** Display name: what the agent's tools are prefixed with and what pages pass as `server`. */
  name: string;
  url: string;
  /**
   * Who shares a cached result. `viewer` keeps each viewer's results apart,
   * as Claude's artifacts do; `shared` lets every viewer of every artifact in
   * this chat reuse one result, for servers whose answers never depend on who
   * asks.
   */
  cacheScope: "viewer" | "shared";
  /** Shown to the model so it knows what the server is for. */
  description: string;
  /**
   * `oauth`: each user signs in to this server themselves (the MCP OAuth flow,
   * from the sidebar), and their chats call it with their own tokens.
   */
  auth?: "oauth";
  /** Tools to leave out, by name: neither the agent nor pages see them. */
  hideTools?: RegExp;
  /**
   * Who a published page may call this server for. Pages call as the
   * artifact's author (the chat's connection), so `author` keeps a server with
   * private data to its author: anyone else viewing the page gets not_granted.
   */
  pageCallers?: "anyone" | "author";
}

/** The environment the server list reads. A plain shape, so tests can pass one. */
export interface McpEnv {
  JUYO_PORTAL_URL?: string;
}

const COINGECKO: McpServerConfig = {
  name: "CoinGecko",
  url: "https://mcp.api.coingecko.com/mcp",
  cacheScope: "viewer",
  description:
    "Live cryptocurrency market data (prices, market caps, volumes, charts, trending coins). " +
    "Code mode: call search_docs to find SDK methods, then execute with an async run(client) function. " +
    "execute wraps what run() returns as {\"result\": <value>}, so a page reads payload.result.",
};

/**
 * The servers every chat's agent connects to: CoinGecko (public, keyless),
 * and Juyo through the Cloudflare MCP portal "juyo". Juyo needs each user's
 * own sign-in: Cloudflare Access for the portal, then Cognito for Juyo, in a
 * popup from the sidebar. Calls then run as that user.
 */
export function mcpServers(env: McpEnv): McpServerConfig[] {
  const servers = [COINGECKO];
  if (env.JUYO_PORTAL_URL) {
    servers.push({
      name: "Juyo",
      url: env.JUYO_PORTAL_URL,
      cacheScope: "viewer",
      pageCallers: "author",
      auth: "oauth",
      // The portal's own tools switch servers on and off for a session; they are not data.
      hideTools: /^portal_/,
      description:
        "Juyo hotel data, read-only, through an MCP portal: tool names start with juyo2_. " +
        "Start with juyo2_whoami and juyo2_list_organizations (pass org when there are several), then juyo2_list_hotels, " +
        "juyo2_list_sources and juyo2_describe_table to find tables, and juyo2_run_query for one read-only SQL statement (30 s limit). " +
        "This is private business data: fetch only what the user asks for, and prefer aggregates to raw rows.",
    });
  }
  return servers;
}
