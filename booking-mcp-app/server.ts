// MCP server for the view-only court-availability app.
//
// It exposes ONE tool, `get_court_availability`, which returns the availability
// grid for a date + sport, and registers a UI resource (the MCP App) linked to
// that tool via `_meta.ui.resourceUri`. The host renders the UI in a sandboxed
// iframe; the UI pulls its data by calling the tool back through the host.
//
// The mock data flows to the SERVER, not to the model: the tool is where the
// booking backend would live. This first phase is read-only (no booking/write).

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js"
import cors from "cors"
import express from "express"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { getAvailability, isoToday, type Sport } from "./availability.js"

const dirname = path.dirname(fileURLToPath(import.meta.url))
// The UI is bundled to a single HTML file by `vite build` (see vite.config.ts).
const APP_HTML = path.join(dirname, "dist", "mcp-app.html")

// `ui://` marks this resource as an MCP App. The path after the scheme is free-form.
const RESOURCE_URI = "ui://court-availability/panel.html"

// Output contract, kept in sync with availability.ts so the host can validate
// the tool's structuredContent.
const AvailabilitySchema = z.object({
  date: z.string(),
  sport: z.string(),
  slots: z.array(z.string()),
  courts: z.array(
    z.object({
      name: z.string(),
      cells: z.array(z.object({ time: z.string(), taken: z.boolean() })),
    }),
  ),
  summary: z.object({ free: z.number(), total: z.number() }),
})

// A fresh server per request keeps the stateless HTTP transport simple.
function createServer(): McpServer {
  const server = new McpServer({ name: "Court Availability", version: "1.0.0" })

  registerAppTool(
    server,
    "get_court_availability",
    {
      title: "Court availability",
      description:
        "Show which courts and time slots are free for a given date and sport. Read only, no booking.",
      inputSchema: {
        date: z.string().describe("ISO date, e.g. 2026-08-21. Defaults to today.").optional(),
        sport: z
          .enum(["Tennis", "Football", "Basketball", "Padel"])
          .describe("Which sport to show courts for. Defaults to Tennis.")
          .optional(),
      },
      outputSchema: AvailabilitySchema,
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ date, sport }): Promise<CallToolResult> => {
      const day = date ?? isoToday()
      const game: Sport = sport ?? "Tennis"
      const availability = getAvailability(day, game)
      const { free, total } = availability.summary
      const line = `${game}, ${day}: ${free} of ${total} slots free across ${availability.courts.length} courts.`
      return {
        content: [{ type: "text", text: line }],
        structuredContent: availability as unknown as Record<string, unknown>,
      }
    },
  )

  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(APP_HTML, "utf-8")
      return { contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] }
    },
  )

  return server
}

const app = express()
app.use(cors())
app.use(express.json())

app.post("/mcp", async (req, res) => {
  const server = createServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  res.on("close", () => {
    transport.close()
    server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
})

const PORT = Number(process.env.PORT ?? 3001)
app.listen(PORT, () => {
  console.log(`Court Availability MCP server on http://localhost:${PORT}/mcp`)
})
