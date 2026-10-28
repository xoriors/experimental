import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectStreamableHttp } from "../worker/mcp/connect.ts";
import { McpFailure } from "../worker/mcp/hub.ts";
import { finishSignIn, McpOAuthClient, serverOfState, startSignIn, type McpAuthRecord, type McpAuthStore } from "../worker/mcp/oauth.ts";
import type { McpServerConfig } from "../worker/mcp/servers.ts";

// A stand-in for the MCP portal: an OAuth authorization server (discovery,
// dynamic registration, PKCE, refresh) in front of an MCP server whose one
// tool says who the bearer token belongs to. The browser part of a sign-in is
// played by the test: it reads the authorization URL and "approves" it.

interface Grant {
  user: string;
  challenge: string;
  redirectUri: string;
  clientId: string;
}

class FakePortal {
  readonly clients = new Map<string, string[]>();
  readonly codes = new Map<string, Grant>();
  readonly access = new Map<string, { user: string; expires: number }>();
  readonly refresh = new Map<string, string>();
  ttlMs = 3_600_000;
  refreshAllowed = true;
  /** Answer the token endpoint the way the edge did in production: a bare 403 "error code: 1014". */
  tokenBlocked = false;
  origin = "";

  issue(user: string) {
    const accessToken = `at-${crypto.randomUUID()}`;
    const refreshToken = `rt-${crypto.randomUUID()}`;
    this.access.set(accessToken, { user, expires: Date.now() + this.ttlMs });
    this.refresh.set(refreshToken, user);
    return { access_token: accessToken, token_type: "Bearer", expires_in: Math.floor(this.ttlMs / 1000), refresh_token: refreshToken };
  }

  /** The user approves the sign-in in the browser: the portal redirects back with a code. */
  approve(authorizationUrl: string, user: string): { code: string; state: string } {
    const url = new URL(authorizationUrl);
    const code = `code-${crypto.randomUUID()}`;
    this.codes.set(code, {
      user,
      challenge: url.searchParams.get("code_challenge")!,
      redirectUri: url.searchParams.get("redirect_uri")!,
      clientId: url.searchParams.get("client_id")!,
    });
    return { code, state: url.searchParams.get("state")! };
  }

  async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, this.origin);
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));

    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return send(200, { resource: `${this.origin}/mcp`, authorization_servers: [this.origin] });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return send(200, {
        issuer: this.origin,
        authorization_endpoint: `${this.origin}/authorize`,
        token_endpoint: `${this.origin}/token`,
        registration_endpoint: `${this.origin}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    const body = await new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
    });
    if (url.pathname === "/register") {
      const metadata = JSON.parse(body);
      const clientId = `client-${this.clients.size + 1}`;
      this.clients.set(clientId, metadata.redirect_uris);
      return send(201, { ...metadata, client_id: clientId });
    }
    if (url.pathname === "/token" && this.tokenBlocked) {
      return res.writeHead(403, { "content-type": "text/plain", "cf-ray": "abc123-ARN" }).end("error code: 1014");
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "authorization_code") {
        const grant = this.codes.get(form.get("code")!);
        this.codes.delete(form.get("code")!);
        const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        const ok = grant && grant.challenge === challenge && grant.redirectUri === form.get("redirect_uri") && grant.clientId === form.get("client_id");
        return ok ? send(200, this.issue(grant.user)) : send(400, { error: "invalid_grant" });
      }
      if (form.get("grant_type") === "refresh_token") {
        const user = this.refresh.get(form.get("refresh_token")!);
        if (!user || !this.refreshAllowed) return send(400, { error: "invalid_grant" });
        this.refresh.delete(form.get("refresh_token")!);
        return send(200, this.issue(user));
      }
      return send(400, { error: "unsupported_grant_type" });
    }
    if (url.pathname === "/mcp") {
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      const session = token ? this.access.get(token) : undefined;
      if (!session || session.expires < Date.now()) {
        return send(401, { error: "invalid_token" }, { "www-authenticate": `Bearer resource_metadata="${this.origin}/.well-known/oauth-protected-resource/mcp"` });
      }
      const server = new McpServer({ name: "stand-in", version: "1.0.0" });
      server.registerTool("data_whoami", { description: "Who am I", annotations: { readOnlyHint: true } }, async () => ({
        content: [{ type: "text", text: JSON.stringify({ user: session.user }) }],
      }));
      server.registerTool("portal_list_servers", { description: "Portal tool" }, async () => ({ content: [{ type: "text", text: "[]" }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
      return;
    }
    send(404, { error: "not_found" });
  }
}

class MemoryStore implements McpAuthStore {
  record: McpAuthRecord = {};
  async get() {
    return structuredClone(this.record);
  }
  async put(record: McpAuthRecord) {
    this.record = structuredClone(record);
  }
}

const REDIRECT = "https://app.example/api/mcp/oauth/callback";
let portal: FakePortal;
let server: Server;
let config: McpServerConfig;

beforeAll(async () => {
  server = createServer((req, res) => void portal.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});
afterAll(() => server.close());
beforeEach(() => {
  portal = new FakePortal();
  portal.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config = { name: "Portal", url: `${portal.origin}/mcp`, cacheScope: "viewer", auth: "oauth" };
});

/** What a chat does: connect with the user's stored tokens, non-interactively. */
async function whoami(store: MemoryStore) {
  const connection = await connectStreamableHttp(config, new McpOAuthClient(store, "Portal", { redirectUrl: store.record.redirectUrl ?? REDIRECT, interactive: false }));
  try {
    const result = await connection.callTool("data_whoami", {});
    return JSON.parse((result.content[0] as { text: string }).text).user as string;
  } finally {
    await connection.close();
  }
}

async function signIn(store: MemoryStore, user: string) {
  const started = await startSignIn(config.url, "Portal", store, REDIRECT);
  if (!("url" in started)) throw new Error("expected a sign-in page");
  const { code, state } = portal.approve(started.url, user);
  await finishSignIn(config.url, "Portal", store, code, state);
}

describe("per-user MCP sign-in", () => {
  it("registers, signs in with PKCE, and calls as that user", async () => {
    const ada = new MemoryStore();
    const started = await startSignIn(config.url, "Portal", ada, REDIRECT);
    expect("url" in started && new URL(started.url).pathname).toBe("/authorize");
    const url = new URL((started as { url: string }).url);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(serverOfState(url.searchParams.get("state")!)).toBe("Portal");
    expect(portal.clients.get(ada.record.client!.client_id)).toEqual([REDIRECT]);

    const { code, state } = portal.approve(url.href, "ada@example.com");
    await finishSignIn(config.url, "Portal", ada, code, state);
    expect(ada.record.tokens?.access_token).toMatch(/^at-/);
    expect(ada.record.state).toBeUndefined();
    expect(ada.record.verifier).toBeUndefined();
    expect(await whoami(ada)).toBe("ada@example.com");
  });

  it("keeps each user's sign-in apart", async () => {
    const ada = new MemoryStore();
    const bob = new MemoryStore();
    await signIn(ada, "ada@example.com");
    await signIn(bob, "bob@example.com");
    expect(await whoami(ada)).toBe("ada@example.com");
    expect(await whoami(bob)).toBe("bob@example.com");
  });

  it("refuses a callback whose state it did not issue", async () => {
    const ada = new MemoryStore();
    const started = await startSignIn(config.url, "Portal", ada, REDIRECT);
    const { code } = portal.approve((started as { url: string }).url, "ada@example.com");
    await expect(finishSignIn(config.url, "Portal", ada, code, "Portal~forged")).rejects.toThrow(/did not start here/);
    expect(ada.record.tokens).toBeUndefined();
  });

  it("refreshes an expired token without a new sign-in", async () => {
    const ada = new MemoryStore();
    await signIn(ada, "ada@example.com");
    const first = ada.record.tokens!.access_token;
    portal.access.get(first)!.expires = 0;
    expect(await whoami(ada)).toBe("ada@example.com");
    expect(ada.record.tokens!.access_token).not.toBe(first);
  });

  it("says auth_required when the sign-in cannot be renewed, without touching a sign-in in progress", async () => {
    const ada = new MemoryStore();
    await signIn(ada, "ada@example.com");
    portal.access.get(ada.record.tokens!.access_token)!.expires = 0;
    portal.refreshAllowed = false;
    ada.record.state = "Portal~open-popup";
    ada.record.verifier = "verifier-of-open-popup";

    const failure = await whoami(ada).catch((error) => error);
    expect(failure).toBeInstanceOf(McpFailure);
    expect((failure as McpFailure).error.code).toBe("auth_required");
    expect(ada.record.state).toBe("Portal~open-popup");
    expect(ada.record.verifier).toBe("verifier-of-open-popup");
  });

  it("drops old tokens when a new sign-in starts, keeping the registration", async () => {
    const ada = new MemoryStore();
    await signIn(ada, "ada@example.com");
    const clientId = ada.record.client!.client_id;
    await startSignIn(config.url, "Portal", ada, REDIRECT);
    expect(ada.record.tokens).toBeUndefined();
    expect(ada.record.client!.client_id).toBe(clientId);
    expect(portal.clients.size).toBe(1);
  });

  it("names the request that failed when the code exchange is refused", async () => {
    const ada = new MemoryStore();
    const started = await startSignIn(config.url, "Portal", ada, REDIRECT);
    const { code, state } = portal.approve((started as { url: string }).url, "ada@example.com");
    portal.tokenBlocked = true;
    await expect(finishSignIn(config.url, "Portal", ada, code, state)).rejects.toThrow(/error code: 1014.*\[POST http:\/\/127\.0\.0\.1:\d+\/token answered 403 \(Cloudflare Ray ID abc123-ARN\)\]/);
  });
});
