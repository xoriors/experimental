import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Worker's configuration lives in cloudflare.config.ts.
// PI_OFFLINE=1 runs without a Cloudflare account: no remote bindings, so the
// model (AI binding) is unavailable but everything else, MCP included, works.
export default defineConfig({
  plugins: [react(), cloudflare({ remoteBindings: process.env.PI_OFFLINE !== "1" })],
});
