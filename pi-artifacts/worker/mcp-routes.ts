import { mcpAuthStore } from "./users.ts";
import { finishSignIn, OAUTH_CALLBACK_PATH, serverOfState, startSignIn } from "./mcp/oauth.ts";
import { mcpServers } from "./mcp/servers.ts";

export interface McpServerStatus {
  name: string;
  /** "oauth": each user signs in themselves. */
  auth: "none" | "oauth";
  /** For oauth servers: whether this user has tokens. They may still have expired; a call then says auth_required. */
  signedIn: boolean;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * The MCP connections routes, for a verified `uid`:
 *   GET  /api/mcp/servers                     the servers and whether this user is signed in to each
 *   POST /api/mcp/servers/:name/sign-in       start a sign-in: { url } to open in a popup
 *   POST /api/mcp/servers/:name/sign-out      forget this user's tokens for the server
 *   GET  /api/mcp/oauth/callback              where the authorization server sends the popup back
 * Returns null for any other path.
 */
export async function mcpRoute(request: Request, env: Env, uid: string): Promise<Response | null> {
  const url = new URL(request.url);
  const servers = mcpServers(env);

  if (url.pathname === "/api/mcp/servers" && request.method === "GET") {
    const statuses: McpServerStatus[] = await Promise.all(
      servers.map(async (server) => ({
        name: server.name,
        auth: server.auth ?? "none",
        signedIn: server.auth === "oauth" ? Boolean((await mcpAuthStore(uid, server.name).get()).tokens) : true,
      })),
    );
    return json(statuses);
  }

  const action = url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/(sign-in|sign-out)$/);
  if (action && request.method === "POST") {
    const server = servers.find((s) => s.name === decodeURIComponent(action[1]) && s.auth === "oauth");
    if (!server) return json({ error: "No such server to sign in to." }, 404);
    const store = mcpAuthStore(uid, server.name);
    if (action[2] === "sign-out") {
      await store.put({});
      return json({ signedIn: false });
    }
    try {
      return json(await startSignIn(server.url, server.name, store, `${url.origin}${OAUTH_CALLBACK_PATH}`));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return json({ error: `${server.name} did not start a sign-in (${server.url} should be an MCP portal's /mcp address): ${reason}` }, 502);
    }
  }

  if (url.pathname === OAUTH_CALLBACK_PATH && request.method === "GET") {
    const state = url.searchParams.get("state") ?? "";
    const server = servers.find((s) => s.name === serverOfState(state) && s.auth === "oauth");
    const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (!server) return callbackPage(url.origin, undefined, "This sign-in link is not for a server this app knows.");
    if (denied || !code) return callbackPage(url.origin, server.name, denied ?? "The sign-in returned no code.");
    try {
      await finishSignIn(server.url, server.name, mcpAuthStore(uid, server.name), code, state);
      return callbackPage(url.origin, server.name);
    } catch (error) {
      return callbackPage(url.origin, server.name, error instanceof Error ? error.message : String(error));
    }
  }

  return null;
}

/** The page the popup lands on: it tells the app the outcome and closes itself on success. */
function callbackPage(origin: string, server: string | undefined, error?: string): Response {
  const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const message = { type: "pi:mcp-sign-in", server, ok: !error, error };
  const body = `<!doctype html><meta charset="utf-8"><title>${error ? "Sign-in failed" : "Signed in"}</title>
<body style="font: 15px system-ui, sans-serif; padding: 32px; max-width: 520px">
<h1 style="font-size: 18px">${error ? "Sign-in failed" : `Signed in to ${escape(server ?? "")}`}</h1>
<p>${error ? escape(error) : "You can close this window."}</p>
<script>
  window.opener?.postMessage(${JSON.stringify(message).replace(/</g, "\\u003c")}, ${JSON.stringify(origin)});
  ${error ? "" : "window.close();"}
</script></body>`;
  return new Response(body, {
    status: error ? 400 : 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      "cache-control": "no-store",
    },
  });
}
