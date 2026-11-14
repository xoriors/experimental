# booking-mcp-app

A **view-only MCP App**: an MCP server that exposes court-availability data and renders it as a
read-only panel inside an MCP host (Claude Desktop, VS Code, or the free local test host), using
the [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) protocol (spec
`2026-01-26`).

This is the first phase of porting the `generative-ui` POC to MCP Apps. Read-only, no booking yet:
the important shift from `generative-ui` is that the data lives on the **server** (the tool), not
in the conversation. The UI only displays what the server returns.

## What it does

The server registers one tool, `get_court_availability`, that returns which courts and time slots
are free for a given **date + sport** from in-memory mock data. The tool is linked to a UI resource
(`ui://court-availability/panel.html`) that the host renders in a sandboxed iframe as a read-only
grid of courts x time slots (free vs taken).

Two data paths, both handled the same way in the UI:

- The **host pushes** a tool result to the app (`app.ontoolresult`) whenever the agent calls
  `get_court_availability`, e.g. with a different date or sport. The panel updates.
- The **app pulls** its own initial data on load (`app.callServerTool`). This is the
  app -> server -> app round trip, and it also populates the panel when it is opened directly.

There are no inputs, no submit, no booking. Changing the date or sport happens by calling the tool
with different arguments (from the agent or the test host), not from a form.

## Layout

```
booking-mcp-app/
  server.ts         MCP server: registers the tool + the ui:// resource, served over HTTP
  availability.ts   the booking domain (sports, courts, slots) + deterministic mock data
  mcp-app.html      UI entry point
  src/
    mcp-app.ts      the view: App client, ontoolresult + callServerTool, renders the grid
    mcp-app.css     panel styling (single light theme)
  vite.config.ts    bundles the UI into one self-contained HTML (vite-plugin-singlefile)
  dist/mcp-app.html the built UI, read by the server and served as the resource
```

Reuses the booking domain from `generative-ui` (Tennis / Football / Basketball / Padel, courts and
time slots). Availability is deterministic per query, so the same date + sport always renders the
same grid.

## Run

Requires Node 18+ (developed on Node 24).

```console
npm install
npm run build      # typecheck + bundle the UI to dist/mcp-app.html
npm run serve      # start the MCP server on http://localhost:3001/mcp
```

`npm start` does the build and serve in one step. Rerun `npm run build` after any UI change; the
server reads `dist/mcp-app.html` fresh on each resource request.

- `npm run check` typechecks only (`tsc --noEmit`).
- `PORT=4000 npm run serve` changes the port.

## See the panel in a host

### Free: the local test host

The [ext-apps](https://github.com/modelcontextprotocol/ext-apps) repo ships a local host that
renders MCP Apps with no account needed.

```console
# 1) in this project, with the server already running (npm run serve)
# 2) in a separate clone of the ext-apps repo:
git clone https://github.com/modelcontextprotocol/ext-apps.git
cd ext-apps/examples/basic-host
npm install
SERVERS='["http://localhost:3001/mcp"]' npm start
```

Open <http://localhost:8080>, call `get_court_availability` (try `{ "sport": "Padel", "date":
"2026-08-21" }`), and the availability grid renders in the iframe. Call it again with a different
sport to see the panel update.

### Claude Desktop (paid plan)

Expose the local server with a tunnel and add it as a custom connector:

```console
npx cloudflared tunnel --url http://localhost:3001
```

In Claude, go to Settings -> Connectors -> Add custom connector, paste the
`https://<something>.trycloudflare.com/mcp` URL, then ask Claude to show court availability.

## References

- MCP Apps overview — <https://modelcontextprotocol.io/extensions/apps/overview>
- Build guide — <https://modelcontextprotocol.io/extensions/apps/build>
- Spec (2026-01-26) — <https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx>
- Examples — <https://github.com/modelcontextprotocol/ext-apps/tree/main/examples>
