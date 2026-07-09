import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // The CopilotKit runtime (server/index.ts) runs separately so the
    // Gemini key stays server-side. Same origin for the browser.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
