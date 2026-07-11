// Minimal runtime for the live chat: exposes a CopilotKit endpoint backed
// by Gemini. The frontend talks to /api/copilotkit through the Vite proxy,
// so the API key never reaches the browser.

import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import {
  CopilotRuntime,
  GoogleGenerativeAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from '@copilotkit/runtime'

// Node's built-in loader has correct dotenv semantics (quotes, export,
// comments, no-override), unlike a hand-rolled trim.
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
} catch {
  // no .env file, rely on the environment
}

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) {
  console.error('GEMINI_API_KEY is missing. Copy .env.example to .env and add your key.')
  process.exit(1)
}
// The Google adapter reads GOOGLE_API_KEY from the environment.
process.env.GOOGLE_API_KEY ??= apiKey
// A local POC has no business phoning home.
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= 'true'

const serviceAdapter = new GoogleGenerativeAIAdapter({ model: 'gemini-2.5-flash' })
const runtime = new CopilotRuntime()

const handler = copilotRuntimeNodeHttpEndpoint({
  endpoint: '/api/copilotkit',
  runtime,
  serviceAdapter,
})

const port = Number(process.env.PORT ?? 4000)
createServer((req, res) => {
  // The handler can reject (e.g. a malformed Host header throws before its
  // own try/catch); an unhandled rejection would crash the process. Awaiting
  // inside try/catch handles both async rejections and synchronous throws.
  void (async () => {
    try {
      await handler(req, res)
    } catch (err) {
      console.error('copilotkit request failed:', err)
      if (!res.headersSent) res.statusCode = 500
      res.end()
    }
  })()
}).listen(port, () => {
  console.log(`copilotkit runtime listening on http://localhost:${port}/api/copilotkit`)
})
