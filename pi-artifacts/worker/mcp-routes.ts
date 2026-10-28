import { mcpAuthStore } from "./users.ts";
import { finishSignIn, OAUTH_CALLBACK_PATH, serverOfState, startSignIn } from "./mcp/oauth.ts";
import { mcpServers } from "./mcp/servers.ts";

/**
 * Sign-in to an MCP server that signs in each user, for a verified `uid`:
 *   GET /api/mcp/sign-in/:name     the link the agent gives in chat: starts the MCP OAuth flow and redirects to it
 *   GET /api/mcp/oauth/callback    where the authorization server sends the browser back
 * Returns null for any other path.
 */
export async function mcpRoute(request: Request, env: Env, uid: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET") return null;
  const servers = mcpServers(env).filter((server) => server.auth === "oauth");

  const start = url.pathname.match(/^\/api\/mcp\/sign-in\/([^/]+)$/);
  if (start) {
    const server = servers.find((s) => s.name === decodeURIComponent(start[1]));
    if (!server) return page("Sign-in failed", "This app has no server by that name to sign in to.", 404);
    try {
      const started = await startSignIn(server.url, server.name, mcpAuthStore(uid, server.name), `${url.origin}${OAUTH_CALLBACK_PATH}`);
      if ("url" in started) return Response.redirect(started.url, 302);
      return page(`Signed in to ${server.name}`, "You already were. Go back to the chat and ask again.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return page("Sign-in failed", `${server.name} did not start a sign-in (${server.url} should be an MCP server or portal address): ${reason}`, 502);
    }
  }

  if (url.pathname === OAUTH_CALLBACK_PATH) {
    const state = url.searchParams.get("state") ?? "";
    const server = servers.find((s) => s.name === serverOfState(state));
    const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (!server) return page("Sign-in failed", "This sign-in link is not for a server this app knows.", 400);
    if (denied || !code) return page("Sign-in failed", denied ?? "The sign-in returned no code.", 400);
    try {
      await finishSignIn(server.url, server.name, mcpAuthStore(uid, server.name), code, state);
      return page(`Signed in to ${server.name}`, "Go back to the chat and ask again. You can close this tab.");
    } catch (error) {
      return page("Sign-in failed", error instanceof Error ? error.message : String(error), 400);
    }
  }

  return null;
}

function page(title: string, message: string, status = 200): Response {
  const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title>
<body style="font: 15px system-ui, sans-serif; padding: 32px; max-width: 560px"><h1 style="font-size: 18px">${escape(title)}</h1><p>${escape(message)}</p></body>`;
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "cache-control": "no-store" },
  });
}
