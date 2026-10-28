import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * One user's OAuth state for one MCP server. It lives in that user's
 * UserDirectory object, so every chat of theirs shares one sign-in and no
 * other user can reach it.
 */
export interface McpAuthRecord {
  /** What dynamic client registration returned. */
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  /** The redirect URL the client was registered with; refreshes reuse it. */
  redirectUrl?: string;
  /** A sign-in in progress: its PKCE verifier and state. */
  verifier?: string;
  state?: string;
}

export interface McpAuthStore {
  get(): Promise<McpAuthRecord>;
  put(record: McpAuthRecord): Promise<void>;
}

/** The callback path the authorization server sends the browser back to. */
export const OAUTH_CALLBACK_PATH = "/api/mcp/oauth/callback";

/** OAuth state is `<server>~<random>`, so the callback knows which server's sign-in it finishes. */
export function serverOfState(state: string): string | undefined {
  const at = state.lastIndexOf("~");
  return at > 0 ? state.slice(0, at) : undefined;
}

/**
 * The MCP SDK's OAuth client, backed by one user's stored record: discovery,
 * dynamic client registration, PKCE, and token refresh happen in the SDK.
 *
 * It never sends anyone anywhere itself. When the SDK wants a sign-in,
 * `redirectToAuthorization` only records the URL: the Worker hands it to the
 * browser to open in a popup. A chat's connection is not `interactive`: if
 * its refresh fails, it records nothing, so it cannot overwrite a sign-in the
 * user has open, and the call fails with auth_required.
 */
export class McpOAuthClient implements OAuthClientProvider {
  authorizationUrl: URL | undefined;
  readonly #store: McpAuthStore;
  readonly #server: string;
  readonly #redirectUrl: string;
  readonly #interactive: boolean;

  constructor(store: McpAuthStore, server: string, options: { redirectUrl: string; interactive: boolean }) {
    this.#store = store;
    this.#server = server;
    // The SDK takes a missing redirect URL for a machine-to-machine flow, so there always is one.
    this.#redirectUrl = options.redirectUrl;
    this.#interactive = options.interactive;
  }

  get redirectUrl(): string {
    return this.#redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "pi-artifacts",
      redirect_uris: [this.#redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async state(): Promise<string> {
    const random = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const state = `${this.#server}~${random}`;
    if (this.#interactive) await this.#patch({ state, redirectUrl: this.#redirectUrl });
    return state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.#store.get()).client;
  }

  async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> {
    await this.#patch({ client });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.#store.get()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.#patch({ tokens });
  }

  redirectToAuthorization(url: URL): void {
    if (this.#interactive) this.authorizationUrl = url;
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    if (this.#interactive) await this.#patch({ verifier });
  }

  async codeVerifier(): Promise<string> {
    const { verifier } = await this.#store.get();
    if (!verifier) throw new Error("No sign-in is in progress.");
    return verifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "discovery") return;
    if (scope === "all") return this.#store.put({});
    const record = await this.#store.get();
    if (scope === "client") delete record.client;
    if (scope === "tokens") delete record.tokens;
    if (scope === "verifier") delete record.verifier;
    await this.#store.put(record);
  }

  async #patch(patch: Partial<McpAuthRecord>): Promise<void> {
    await this.#store.put({ ...(await this.#store.get()), ...patch });
  }
}

/**
 * Start a sign-in: returns the URL to open in a popup, or `signedIn` when the
 * stored tokens still work. Any old tokens are dropped first, so the user
 * always gets the login screen; a client registration made for this same
 * redirect URL is kept.
 */
export async function startSignIn(serverUrl: string, server: string, store: McpAuthStore, redirectUrl: string): Promise<{ url: string } | { signedIn: true }> {
  const record = await store.get();
  await store.put(record.client && record.redirectUrl === redirectUrl ? { client: record.client, redirectUrl } : { redirectUrl });
  const client = new McpOAuthClient(store, server, { redirectUrl, interactive: true });
  const trace = tracedFetch();
  const result = await auth(client, { serverUrl, fetchFn: trace.fetch }).catch(trace.explain);
  if (result === "AUTHORIZED") return { signedIn: true };
  if (!client.authorizationUrl) throw new Error(`${server} did not return a sign-in page.`);
  return { url: client.authorizationUrl.href };
}

/** Finish a sign-in from the callback: check the state, exchange the code for tokens, clear the sign-in in progress. */
export async function finishSignIn(serverUrl: string, server: string, store: McpAuthStore, code: string, state: string): Promise<void> {
  const record = await store.get();
  if (!record.state || record.state !== state || !record.redirectUrl) throw new Error("This sign-in did not start here, or a newer one replaced it. Open the sign-in link again.");
  const client = new McpOAuthClient(store, server, { redirectUrl: record.redirectUrl, interactive: true });
  const trace = tracedFetch();
  await auth(client, { serverUrl, authorizationCode: code, fetchFn: trace.fetch }).catch(trace.explain);
  const { state: _state, verifier: _verifier, ...done } = await store.get();
  await store.put(done);
}

/**
 * A fetch for the SDK's OAuth requests that remembers the last one that did
 * not succeed, so a failed sign-in says which request failed: method, URL
 * without its query, status, and Cloudflare's Ray ID when there is one.
 */
function tracedFetch() {
  let failed: string | undefined;
  return {
    fetch: async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const response = await fetch(input, init);
      if (!response.ok) {
        const url = new URL(String(input));
        const ray = response.headers.get("cf-ray");
        failed = `${init?.method ?? "GET"} ${url.origin}${url.pathname} answered ${response.status}${ray ? ` (Cloudflare Ray ID ${ray})` : ""}`;
      }
      return response;
    },
    explain: (error: unknown): never => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(failed ? `${message} [${failed}]` : message);
    },
  };
}
