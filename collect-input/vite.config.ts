import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

// The UI bundles to one self-contained HTML (JS and CSS inlined), which the
// server serves as the ui:// resource. The app iframe is deny-by-default CSP,
// so nothing may be fetched from outside; inlining sidesteps that entirely.
const input = process.env.INPUT
if (!input) throw new Error("INPUT environment variable is not set (e.g. INPUT=mcp-app.html)")

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    rollupOptions: { input },
    outDir: "dist",
    emptyOutDir: false,
  },
})
