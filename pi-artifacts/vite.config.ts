import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// PI_OFFLINE=1 runs without a Cloudflare account: no remote bindings, so the
// model (AI binding) is unavailable but everything else, MCP included, works.
// PI_NO_DOCKER=1 runs without Docker: no sandbox container, and no run_python tool.
const offline = process.env.PI_OFFLINE === "1";
const noDocker = process.env.PI_NO_DOCKER === "1";

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      remoteBindings: !offline,
      config: noDocker ? (config) => ({ dev: { ...config.dev, enable_containers: false }, vars: { ...config.vars, SANDBOX_ENABLED: "false" } }) : undefined,
    }),
  ],
});
