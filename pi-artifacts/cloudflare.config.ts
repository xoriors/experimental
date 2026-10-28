import { bindings, defineConfig, defineContainer, exports } from "cf/config";
import { existsSync, readFileSync } from "node:fs";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

// PI_NO_DOCKER=1 leaves out the sandbox container (and the run_python and run_bash tools), for machines without Docker.
const withSandbox = process.env.PI_NO_DOCKER !== "1";

/**
 * The MCP servers every chat connects to, as [{ name, url, auth? }]. Each deployment keeps its own list out of the
 * repository: PI_MCP_SERVERS (JSON) if set, else mcp-servers.json (gitignored; see mcp-servers.example.json), else
 * only the public demo server.
 */
function mcpServerList(): { name: string; url: string; auth?: "oauth" }[] {
  if (process.env.PI_MCP_SERVERS) return JSON.parse(process.env.PI_MCP_SERVERS);
  const file = new URL("./mcp-servers.json", import.meta.url);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  return [{ name: "CoinGecko", url: "https://mcp.api.coingecko.com/mcp" }];
}

// One Linux container per chat for run_python and run_bash. See Dockerfile.
const sandbox = defineContainer({
  name: "pi-artifacts-sandbox",
  schedulingPolicy: "durable-object",
  images: { sandbox: { dockerfile: "./Dockerfile" } },
});

export default defineConfig({
  worker: {
    name: "pi-artifacts",
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    observability: { enabled: true },
    // The React app. Everything the Worker answers itself is listed in
    // runWorkerFirst; any other path falls back to the SPA's index.html.
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*", "/u/*"],
    },
    env: {
      // A pi-ai Cloudflare AI Gateway specifier, or a Workers AI id such as @cf/zai-org/glm-5.3-flash.
      MODEL: bindings.text("anthropic/claude-sonnet-5.5"),
      AI_GATEWAY_ID: bindings.text("pi-artifacts"),
      // Alias of the provider key stored in the gateway (Provider Keys). Empty: the key aliased "default", else unified billing.
      AI_BYOK_ALIAS: bindings.text(""),
      SANDBOX_ENABLED: bindings.text(withSandbox ? "true" : "false"),
      // Who is signed in. "access" (the default, and the only mode to deploy): a verified Cloudflare Access token.
      // "demo" (AUTH_MODE=demo pnpm dev): a typed name in a cookie, for local development only.
      AUTH_MODE: bindings.text(process.env.AUTH_MODE === "demo" ? "demo" : "access"),
      ACCESS_TEAM_DOMAIN: bindings.text("xorio42.cloudflareaccess.com"),
      // The Access application's audience (AUD) tag, from Zero Trust → Access → Applications → pi-artifacts.
      ACCESS_AUD: bindings.text("21dcccf4fbfa5991beb76a9ac48ff0c0de86d3c1a55597c82e141559e3ebcdc9"),
      // 32+ random bytes, base64. Each user's files are encrypted with a key derived from it: losing it loses the files.
      FILES_MASTER_KEY: bindings.secret(),
      // DEV_TOOLS=true (when running pnpm dev) enables POST /api/dev/chats/:id/publish. Never set it for a deploy.
      DEV_TOOLS: bindings.text(process.env.DEV_TOOLS === "true" ? "true" : "false"),
      // The MCP servers every chat connects to: just a name and a URL each (see mcpServerList above). The agent learns
      // what a server offers from the server, and you name servers and tools in chat. "oauth": each user signs in, from
      // a link the agent gives. A Cloudflare MCP portal is one entry for every server behind it.
      MCP_SERVERS: bindings.json(mcpServerList()),
      // Workers AI binding. Pi's createAI() routes Claude through AI Gateway with it.
      AI: bindings.ai({}),
      // Each user's files (users/<uid>/files/…), and a read cache of artifact versions (artifacts/<id>/…).
      FILES: bindings.r2({ name: "pi-artifacts" }),
      // Cloudflare Artifacts: one Git repo per published artifact, the source of truth for its versions.
      // Local development uses a local Git backend, so it never touches the deployed repos.
      REPOS: bindings.artifacts({ namespace: "pi-artifacts", dev: { remote: false } }),
    },
    // The Worker reaches its own Durable Objects through `exports` from cloudflare:workers, not bindings.
    exports: {
      ChatAgent: exports.durableObject({ storage: "sqlite" }),
      UserDirectory: exports.durableObject({ storage: "sqlite" }),
      Sandbox: withSandbox ? exports.durableObject({ storage: "sqlite", container: sandbox }) : exports.durableObject({ storage: "sqlite" }),
    },
  },
  containers: withSandbox ? [sandbox] : [],
});
