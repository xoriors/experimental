import { describe, expect, it } from "vitest";
import { canonicalJson } from "../shared/canonical.ts";
import { McpFailure, McpHub, type McpConnection, type RawToolResult } from "../worker/mcp/hub.ts";
import { mcpServers, type McpServerConfig } from "../worker/mcp/servers.ts";

const viewerScoped: McpServerConfig = { name: "Prices", url: "https://example.invalid/mcp", cacheScope: "viewer" };
const sharedScoped: McpServerConfig = { ...viewerScoped, name: "Public", cacheScope: "shared" };

function fakeServer(answer: (name: string, args: unknown) => RawToolResult | Promise<RawToolResult>) {
  const calls: { name: string; args: unknown }[] = [];
  let connects = 0;
  const connection: McpConnection = {
    listTools: async () => [{ name: "price", description: "", annotations: { readOnlyHint: true } }],
    callTool: async (name, args) => {
      calls.push({ name, args });
      return answer(name, args);
    },
    close: async () => {},
  };
  return {
    calls,
    connects: () => connects,
    connector: async () => {
      connects++;
      return connection;
    },
  };
}

const text = (value: unknown): RawToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

describe("canonicalJson", () => {
  it("ignores property order at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
  });
});

describe("McpHub.read", () => {
  it("parses the first text block as the payload", async () => {
    const server = fakeServer(() => text({ btc: 80000 }));
    const hub = new McpHub([viewerScoped], server.connector);
    const read = await hub.read("Prices", "price", {}, { staleMs: 30_000, viewer: "ann" });
    expect(read.result.payload).toEqual({ btc: 80000 });
  });

  it("serves a fresh entry from cache and hints when to come back", async () => {
    let now = 1_000_000;
    const server = fakeServer(() => text({ n: server.calls.length }));
    const hub = new McpHub([viewerScoped], server.connector, () => now);

    const first = await hub.read("Prices", "price", { ids: "btc" }, { staleMs: 30_000, viewer: "ann" });
    expect(first.result.cache).toBeUndefined();
    expect(first.nextRefreshAt).toBe(now + 30_000);

    now += 10_000;
    const second = await hub.read("Prices", "price", { ids: "btc" }, { staleMs: 30_000, viewer: "ann" });
    expect(server.calls).toHaveLength(1);
    expect(second.result.cache).toEqual({ storedAt: 1_000_000, revalidating: false });
    expect(second.nextRefreshAt).toBe(1_030_000);

    now += 25_000;
    const third = await hub.read("Prices", "price", { ids: "btc" }, { staleMs: 30_000, viewer: "ann" });
    expect(server.calls).toHaveLength(2);
    expect(third.storedAt).toBe(now);
  });

  it("keeps viewers apart on a viewer-scoped server", async () => {
    const server = fakeServer(() => text({}));
    const hub = new McpHub([viewerScoped], server.connector);
    await hub.read("Prices", "price", {}, { staleMs: 30_000, viewer: "ann" });
    await hub.read("Prices", "price", {}, { staleMs: 30_000, viewer: "bob" });
    expect(server.calls).toHaveLength(2);
  });

  it("shares one result across viewers on a shared-scoped server", async () => {
    const server = fakeServer(() => text({}));
    const hub = new McpHub([sharedScoped], server.connector);
    await hub.read("Public", "price", {}, { staleMs: 30_000, viewer: "ann" });
    await hub.read("Public", "price", {}, { staleMs: 30_000, viewer: "bob" });
    expect(server.calls).toHaveLength(1);
  });

  it("coalesces identical calls in flight into one upstream request", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const server = fakeServer(async () => {
      await gate;
      return text({ ok: true });
    });
    const hub = new McpHub([sharedScoped], server.connector);
    const reads = [1, 2, 3].map(() => hub.read("Public", "price", { a: 1, b: 2 }, { staleMs: 0, viewer: "ann" }));
    const reordered = hub.read("Public", "price", { b: 2, a: 1 }, { staleMs: 0, viewer: "ann" });
    release();
    await Promise.all([...reads, reordered]);
    expect(server.calls).toHaveLength(1);
  });

  it("does not cache a tool error", async () => {
    const server = fakeServer(() => ({ content: [{ type: "text", text: "bad coin" }], isError: true }));
    const hub = new McpHub([viewerScoped], server.connector);
    const attempt = () => hub.read("Prices", "price", {}, { staleMs: 30_000, viewer: "ann" });
    await expect(attempt()).rejects.toMatchObject({ error: { code: "tool_error", message: "bad coin" } });
    await expect(attempt()).rejects.toBeInstanceOf(McpFailure);
    expect(server.calls).toHaveLength(2);
  });

  it("rejects an unknown server as not connected", async () => {
    const hub = new McpHub([viewerScoped], fakeServer(() => text({})).connector);
    await expect(hub.read("Nope", "price", {}, { staleMs: 0, viewer: "ann" })).rejects.toMatchObject({
      error: { code: "server_not_connected" },
    });
  });

  it("reconnects once when the session fails, then reports the server unavailable", async () => {
    let failures = 1;
    const server = fakeServer(() => {
      if (failures-- > 0) throw new Error("Session not found");
      return text({ ok: true });
    });
    const hub = new McpHub([viewerScoped], server.connector);
    await expect(hub.call("Prices", "price", {})).resolves.toMatchObject({ payload: { ok: true } });
    expect(server.connects()).toBe(2);

    failures = 2;
    await expect(hub.call("Prices", "price", {})).rejects.toMatchObject({ error: { code: "server_unavailable", retryable: true } });
  });
});

describe("McpHub with signed-in servers", () => {
  it("passes on what the server says about itself", async () => {
    const connection: McpConnection = { instructions: "Example data. Start with whoami.", listTools: async () => [], callTool: async () => text({}), close: async () => {} };
    const hub = new McpHub([viewerScoped], async () => connection);
    expect(await hub.instructions("Prices")).toBe("Example data. Start with whoami.");
  });

  it("connects afresh after a sign-in, instead of keeping the failed connection", async () => {
    let signedIn = false;
    const connection: McpConnection = { listTools: async () => [], callTool: async () => text({ ok: true }), close: async () => {} };
    const hub = new McpHub([viewerScoped], async (server) => {
      if (!signedIn) throw new McpFailure({ code: "auth_required", server: server.name, message: "Not signed in." });
      return connection;
    });
    await expect(hub.call("Prices", "price", {})).rejects.toMatchObject({ error: { code: "auth_required" } });
    signedIn = true;
    expect((await hub.call("Prices", "price", {})).payload).toEqual({ ok: true });
  });
});

describe("mcpServers", () => {
  it("takes name and URL entries from the binding and drops malformed ones", () => {
    const servers = mcpServers({
      MCP_SERVERS: [
        { name: "CoinGecko", url: "https://mcp.api.coingecko.com/mcp" },
        { name: "portal", url: "https://mcp.example.com/mcp", auth: "oauth" },
        { name: "no url" },
        { name: "../evil", url: "https://x.example/mcp" },
        { name: "ftp", url: "ftp://x.example" },
      ],
    });
    expect(servers.map((s) => s.name)).toEqual(["CoinGecko", "portal"]);
    expect(mcpServers({})).toEqual([]);
  });
});
