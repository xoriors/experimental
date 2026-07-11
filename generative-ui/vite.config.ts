import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The CopilotKit runtime (server/index.ts) runs separately so the Gemini
// key stays server-side. Proxy /api to it for both dev and preview.
const proxy = { '/api': 'http://localhost:4000' }

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
