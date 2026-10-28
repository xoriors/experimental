import { afterAll, describe, expect, it } from "vitest";
import { connectStreamableHttp } from "../worker/mcp/connect.ts";
import { McpHub } from "../worker/mcp/hub.ts";
import { mcpServers } from "../worker/mcp/servers.ts";

// Calls the real public CoinGecko MCP server. Run with LIVE=1 pnpm test.
describe.skipIf(!process.env.LIVE)("CoinGecko MCP (live)", () => {
  const hub = new McpHub(mcpServers({}), connectStreamableHttp);
  afterAll(() => hub.close());

  it("lists read-only code-mode tools", async () => {
    const tools = await hub.tools("CoinGecko");
    const execute = tools.find((tool) => tool.name === "execute");
    expect(execute?.annotations?.readOnlyHint).toBe(true);
  });

  it("returns live prices through execute", async () => {
    const read = await hub.read(
      "CoinGecko",
      "execute",
      { code: `async function run(client) { return client.simple.price.get({ ids: "bitcoin", vs_currencies: "usd" }); }` },
      { staleMs: 30_000, viewer: "test" },
    );
    const payload = read.result.payload as { result: { bitcoin: { usd: number } } };
    expect(payload.result.bitcoin.usd).toBeGreaterThan(0);
  }, 60_000);
});
