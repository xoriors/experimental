// Minimal runtime for the live chat: exposes a CopilotKit endpoint backed
// by Gemini. The frontend talks to /api/copilotkit through the Vite proxy,
// so the API key never reaches the browser.

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import {
  CopilotRuntime,
  GoogleGenerativeAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from '@copilotkit/runtime'

// Tiny .env loader, enough for one key and zero dependencies.
try {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
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
  void handler(req, res)
}).listen(port, () => {
  console.log(`copilotkit runtime listening on http://localhost:${port}/api/copilotkit`)
})
