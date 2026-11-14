import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

// The UI bundles to ONE self-contained HTML file (JS + CSS inlined). The MCP
// server reads that file and serves it as the ui:// resource, which sidesteps
// the app iframe's deny-by-default CSP without declaring external origins.
const input = process.env.INPUT
if (!input) throw new Error("INPUT environment variable is not set (e.g. INPUT=mcp-app.html)")

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    rollupOptions: { input },
    outDir: "dist",
    emptyOutDir: false,
  },
})
