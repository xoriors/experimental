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
}

/** The servers every chat's agent connects to. No auth for now, so only public keyless servers. */
export const MCP_SERVERS: McpServerConfig[] = [
  {
    name: "CoinGecko",
    url: "https://mcp.api.coingecko.com/mcp",
    cacheScope: "viewer",
    description:
      "Live cryptocurrency market data (prices, market caps, volumes, charts, trending coins). " +
      "Code mode: call search_docs to find SDK methods, then execute with an async run(client) function.",
  },
];
