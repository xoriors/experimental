import { bindings, defineConfig, defineContainer, exports } from "cf/config";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

// PI_NO_DOCKER=1 leaves out the sandbox container (and the run_python tool), for machines without Docker.
const withSandbox = process.env.PI_NO_DOCKER !== "1";

// One Linux container per chat for run_python. See Dockerfile.
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
      SANDBOX_ENABLED: bindings.text(withSandbox ? "true" : "false"),
      // DEV_TOOLS=true (when running pnpm dev) enables POST /api/dev/chats/:id/publish. Never set it for a deploy.
      DEV_TOOLS: bindings.text(process.env.DEV_TOOLS === "true" ? "true" : "false"),
      // Workers AI binding. Pi's createAI() routes Claude through AI Gateway with it.
      AI: bindings.ai({}),
      // Artifact versions (artifacts/<id>/v<n>/…) and each user's files (users/<uid>/files/…).
      FILES: bindings.r2({ name: "pi-artifacts" }),
      CHAT: bindings.durableObject({ worker: "pi-artifacts", exportName: "ChatAgent" }),
      USERS: bindings.durableObject({ worker: "pi-artifacts", exportName: "UserDirectory" }),
      SANDBOX: bindings.durableObject({ worker: "pi-artifacts", exportName: "Sandbox" }),
    },
    exports: {
      ChatAgent: exports.durableObject({ storage: "sqlite" }),
      UserDirectory: exports.durableObject({ storage: "sqlite" }),
      Sandbox: withSandbox ? exports.durableObject({ storage: "sqlite", container: sandbox }) : exports.durableObject({ storage: "sqlite" }),
    },
  },
  containers: withSandbox ? [sandbox] : [],
});
