// collect-input: a domain-agnostic MCP server that does exactly one thing,
// render a form the model designed and hand back what the user entered.
//
// It has no idea what a hotel is, or a flight, or a court. The model decides
// what to ask, this server draws it, the answers go back, and the model does
// whatever comes next with its own tools. Write it once, use it for every
// domain you bolt onto an agent.
//
// The round trip:
//   model -> collect_input -> form -> user -> ui/message -> model
//
// The server appears once, in the middle, and then it is out of the way. The
// one exception is validation: the view calls validate_input (an app-only
// tool, invisible to the model) so the rules live on the server, in spec.ts,
// rather than being reimplemented per client.

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
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { specProblems, SpecSchema, validate, type Spec, type Values } from "./spec.js"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_HTML = path.join(dirname, "dist", "mcp-app.html")

const RESOURCE_URI = "ui://collect-input/form.html"

// Specs live here between rendering the form and validating the answers, so
// the view only has to hand back a form id. The transport is stateless (a new
// McpServer per request) but this module is loaded once, so the map persists.
// It is bounded: forms are short-lived and abandoned ones must not accumulate.
const MAX_OPEN_FORMS = 200
const openForms = new Map<string, Spec>()

function rememberSpec(spec: Spec): string {
  if (openForms.size >= MAX_OPEN_FORMS) {
    const oldest = openForms.keys().next().value
    if (oldest !== undefined) openForms.delete(oldest)
  }
  const formId = randomUUID()
  openForms.set(formId, spec)
  return formId
}

function createServer(): McpServer {
  const server = new McpServer({ name: "collect-input", version: "1.0.0" })

  registerAppTool(
    server,
    "collect_input",
    {
      title: "Collect input from the user",
      description:
        "Ask the user for structured input with a real form instead of a back-and-forth in prose. " +
        "One form beats five rounds of questions. " +
        "You design the fields; this renders them and the answers come back as the user's next message. " +
        "Use it whenever you need several specifics before you can act (booking details, filters, " +
        "preferences, configuration, a confirmation). Pre-fill `default` for anything you already " +
        "know so the form only asks for the gaps. " +
        "After calling this, STOP. Do not also ask the same questions in text and do not guess the " +
        "answers: the user is already answering them in the form, and their reply carries the values. " +
        "Field types: text, textarea, number, date, time, select, cards, multiselect, boolean, range.",
      inputSchema: SpecSchema.shape,
      outputSchema: z.object({
        formId: z.string(),
        status: z.string(),
        // Echoed so the view renders straight from the tool result.
        spec: SpecSchema,
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (spec): Promise<CallToolResult> => {
      const problems = specProblems(spec as Spec)
      if (problems.length > 0) {
        // Hand the model a precise reason so it can fix the spec and retry.
        return {
          isError: true,
          content: [{ type: "text", text: `Invalid form spec: ${problems.join("; ")}` }],
        }
      }

      const formId = rememberSpec(spec as Spec)
      return {
        content: [
          {
            type: "text",
            // The instruction is repeated here on purpose: models default hard
            // to rendering the form and then narrating every question under it,
            // which is worse than either alone.
            text:
              `Showing "${spec.title}" to the user. Stop here: do not ask these questions in ` +
              `text as well. Their answers arrive as their next message.`,
          },
        ],
        // The view renders from this: the spec it must draw, plus the id it
        // quotes back when asking the server to check the answers.
        structuredContent: { formId, status: "awaiting-user", spec } as unknown as Record<
          string,
          unknown
        >,
      }
    },
  )

  // App-only: the form calls this on submit, the model never sees it. Keeping
  // the rules server-side means every client validates identically.
  registerAppTool(
    server,
    "validate_input",
    {
      title: "Validate collected input",
      description: "Internal: check a form's answers against the spec that produced it.",
      inputSchema: {
        formId: z.string(),
        values: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
        ),
      },
      outputSchema: z.object({
        valid: z.boolean(),
        errors: z.record(z.string(), z.string()),
      }),
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ formId, values }): Promise<CallToolResult> => {
      const spec = openForms.get(formId)
      if (!spec) {
        return {
          isError: true,
          content: [{ type: "text", text: "Unknown or expired form." }],
        }
      }
      const result = validate(spec, values as Values)
      // The answers are on their way to the model, so the form is done with.
      if (result.valid) openForms.delete(formId)
      return {
        content: [
          {
            type: "text",
            text: result.valid
              ? "Valid."
              : `Invalid: ${Object.entries(result.errors)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("; ")}`,
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
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

const PORT = Number(process.env.PORT ?? 3002)
app.listen(PORT, () => {
  console.log(`collect-input MCP server on http://localhost:${PORT}/mcp`)
})
