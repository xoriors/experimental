import "./mcp-app.css"
import { App } from "@modelcontextprotocol/ext-apps"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"

// The view-only MCP App. It renders a read-only availability grid and never
// collects input. Data comes from the server two ways, both handled the same:
//   - the host pushes a tool result (app.ontoolresult) when the agent calls
//     get_court_availability, e.g. with a new date or sport;
//   - the app pulls its own initial data on load (app.callServerTool), which is
//     the app -> server -> app round trip.

const TOOL = "get_court_availability"

interface Cell {
  time: string
  taken: boolean
}
interface Court {
  name: string
  cells: Cell[]
}
interface Availability {
  date: string
  sport: string
  slots: string[]
  courts: Court[]
  summary: { free: number; total: number }
}

const root = document.getElementById("root") as HTMLElement

function state(text: string): void {
  root.replaceChildren(el("div", "state", text))
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function render(a: Availability): void {
  const { free, total } = a.summary

  const heading = el("div", "head-main")
  heading.append(el("h1", undefined, a.sport), el("p", "date", formatDate(a.date)))

  const badge = el("div", "badge")
  badge.append(el("span", "badge-n", String(free)), el("span", "badge-l", `of ${total} slots free`))

  const head = el("header", "head")
  head.append(heading, badge)

  const grid = el("div", "grid")
  grid.style.gridTemplateColumns = `minmax(84px, max-content) repeat(${a.slots.length}, minmax(40px, 1fr))`
  grid.append(el("div", "c corner"))
  for (const slot of a.slots) grid.append(el("div", "c col", slot))
  for (const court of a.courts) {
    grid.append(el("div", "c row", court.name))
    for (const cell of court.cells) {
      const node = el("div", `c slot ${cell.taken ? "taken" : "open"}`, cell.taken ? "" : "✓")
      const label = `${court.name} at ${cell.time}: ${cell.taken ? "taken" : "free"}`
      node.title = label
      node.setAttribute("aria-label", label)
      grid.append(node)
    }
  }

  const legend = el("div", "legend")
  const free_key = el("span", "key")
  free_key.append(el("i", "sw open"), el("span", undefined, "Free"))
  const taken_key = el("span", "key")
  taken_key.append(el("i", "sw taken"), el("span", undefined, "Taken"))
  legend.append(free_key, taken_key, el("span", "note", "Read only view"))

  root.replaceChildren(head, grid, legend)
}

function renderResult(result: CallToolResult): void {
  const data = result.structuredContent as Availability | undefined
  if (!data || !Array.isArray(data.courts)) {
    state("No availability to show.")
    return
  }
  render(data)
}

async function main(): Promise<void> {
  const app = new App({ name: "Court Availability", version: "1.0.0" })

  // Register handlers before connecting: the host may push a result immediately.
  app.ontoolresult = renderResult
  app.onerror = (err) => console.error(err)

  await app.connect()

  // Pull the initial view ourselves. This exercises the app -> server -> app
  // round trip and populates the panel even when opened without a prior call.
  try {
    renderResult(await app.callServerTool({ name: TOOL, arguments: {} }))
  } catch (err) {
    console.error(err)
    state("Could not reach the availability server.")
  }
}

void main()
