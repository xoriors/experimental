import { useCallback, useEffect, useState } from "react";
import { api, type McpServerStatus } from "./api.ts";

/**
 * The MCP servers this user's chats use. A server that needs the user's own
 * login gets Sign in: a popup runs the OAuth flow (for the Juyo portal:
 * Cloudflare Access, then Cognito), and its last page posts the outcome back.
 */
export function Connections() {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => api.mcpServers().then(setServers, () => {}), []);
  useEffect(() => {
    refresh();
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.data?.type !== "pi:mcp-sign-in") return;
      setBusy(null);
      setError(event.data.ok ? null : `${event.data.server ?? "Sign-in"}: ${event.data.error}`);
      refresh();
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [refresh]);

  async function signIn(name: string) {
    setError(null);
    // Open the window inside the click, or the browser blocks it; it gets its address once the server answers.
    const popup = open("about:blank", "mcp-sign-in", "popup,width=520,height=720");
    if (!popup) return setError("The browser blocked the sign-in window. Allow popups for this site and try again.");
    setBusy(name);
    try {
      const started = await api.mcpSignIn(name);
      if ("url" in started) popup.location.href = started.url;
      else {
        popup.close();
        setBusy(null);
        refresh();
      }
    } catch (e) {
      popup.close();
      setBusy(null);
      setError((e as Error).message);
    }
  }

  async function signOut(name: string) {
    await api.mcpSignOut(name).catch((e: Error) => setError(e.message));
    refresh();
  }

  if (servers.length === 0) return null;
  return (
    <>
      <h3>Connections</h3>
      <nav className="connections">
        {servers.map((server) => (
          <div key={server.name} className="connection">
            <span title={server.auth === "oauth" ? "Needs your own sign-in" : "Public, no sign-in"}>
              <i className={server.signedIn ? "dot on" : "dot"} aria-hidden="true" />
              {server.name}
            </span>
            {server.auth === "oauth" &&
              (server.signedIn ? (
                <button type="button" onClick={() => signOut(server.name)}>
                  Sign out
                </button>
              ) : (
                <button type="button" className="primary" disabled={busy === server.name} onClick={() => signIn(server.name)}>
                  {busy === server.name ? "Signing in…" : "Sign in"}
                </button>
              ))}
          </div>
        ))}
        {error && <p className="form-error connection-error">{error}</p>}
      </nav>
    </>
  );
}
