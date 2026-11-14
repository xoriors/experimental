# collect-input

A domain-agnostic MCP server that does exactly one thing: render a form the model designed, and
hand back what the user entered.

It has no idea what a hotel is. Or a flight, or a database. The model decides what to ask; this
server draws it; the answers go back; the model does whatever comes next with whatever other tools
it has. That separation is the whole point: you write this server once and it works for every
domain you ever bolt onto your agent.

Built on [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) (spec `2026-01-26`).

## The contract

One tool. The model sends a field spec:

```json
{
  "title": "Flight details",
  "intent": "A few specifics and I'll search.",
  "fields": [
    { "key": "depart_from", "label": "Departing from", "type": "text",
      "default": "Cluj-Napoca", "required": true },
    { "key": "dates", "label": "Outbound", "type": "date", "required": true },
    { "key": "cabin", "label": "Cabin", "type": "cards", "required": true,
      "options": [
        { "value": "economy", "label": "Economy", "detail": "from EUR 89" },
        { "value": "premium", "label": "Premium", "detail": "from EUR 210" },
        { "value": "business", "label": "Business", "detail": "from EUR 640" }
      ]},
    { "key": "bags", "label": "Checked bags", "type": "range",
      "min": 0, "max": 3, "default": 1 },
    { "key": "flexible", "label": "Dates flexible ±3 days", "type": "boolean" }
  ]
}
```

...and gets back, as the user's next message, a prose summary followed by a JSON block:

````text
Here is what I picked:

Departing from: Cluj-Napoca
Outbound: 2026-09-12
Cabin: Premium
Checked bags: 2
Dates flexible: yes

```json
{ "depart_from": "Cluj-Napoca", "dates": "2026-09-12",
  "cabin": "premium", "bags": 2, "flexible": true }
```
````

The prose keeps the transcript readable for a human scrolling back, and names the option's label
where the JSON carries its value. The JSON block is what the model should parse, so parsing cannot
drift as the wording changes.

**Field types:** `text`, `textarea`, `number`, `date`, `time`, `select`, `cards`, `multiselect`,
`boolean`, `range`. Every field takes `default`, so the model pre-fills anything it already
inferred and only genuinely asks for the gaps. Optional extras per field: `help`, `placeholder`,
`required`, `min`, `max`, `step`, and `options` (with `value`, `label`, and an optional `detail`
second line).

## Why the server stays dumb

There is deliberately no app-only *submit* tool. In the hotel version, the form's button called
`hold_room`, which meant the server had to know what a room hold was. Here the view skips the
server on submit and goes straight to `ui/message`. The round trip is:

```text
model -> collect_input -> form -> user -> ui/message -> model -> (its own tools)
```

The server appears once, in the middle, and then it's out.

## Validation

The one thing the server does still own is **validation**, through `validate_input`, an app-only
tool (`_meta.ui.visibility: ["app"]`, so the model never sees it and cannot call it). On submit the
view calls it, shows any errors inline, and only sends `ui/message` once the answers pass.

The rules live in [`spec.ts`](spec.ts): required fields, numeric and date bounds, and membership in
`options` for the choice types. Dates and times are checked for meaning rather than shape, so
`2026-02-31` and `29:99` are rejected the way any other nonsense would be. Keeping the rules
server-side means every client validates identically and the model can trust what reaches it,
rather than each view reimplementing them and drifting. The view stays a renderer.

The spec itself is checked the same way before a form is ever shown. A `select` with no `options`,
a duplicate `key`, a `number` whose `min` is text, a default that is not among the offered options,
or bounds like `min: 10, max: 2` that no answer could satisfy are all rejected by `collect_input`
with a precise reason, so the model can fix the spec and retry instead of rendering a form the user
cannot complete.

## Why there is no UI library

The host pushes a full set of design tokens into the app (`--color-text-primary`,
`--color-border-*`, `--border-radius-*`, `--font-sans`, and about seventy more), which
[`src/mcp-app.css`](src/mcp-app.css) styles against, with fallbacks for running outside a host. The
SDK's `applyHostStyleVariables`, `applyHostFonts` and `applyDocumentTheme` wire them up on connect.

That is the "component library" here: the form inherits the surrounding chat's palette, radii and
type in either theme, for free. A kit like MUI or Tailwind would ship its own look, fight the
host's, and bloat a bundle that has to be inlined into a single HTML file. None of the examples in
the `ext-apps` repo use one either.

## Layout

```text
collect-input/
  spec.ts           the field-spec contract and the validation rules (shared)
  server.ts         collect_input + validate_input + the ui:// resource
  mcp-app.html      UI entry point
  src/
    mcp-app.tsx     the view: renders the 10 field types, validates, sends
    mcp-app.css     styled with the host's design tokens
  vite.config.ts    bundles the UI into one self-contained HTML
```

## Run

Node 18+.

```console
npm install
npm run build      # typecheck + bundle the UI to dist/mcp-app.html
npm run serve      # http://localhost:3002/mcp
```

`npm start` does both. `npm run check` typechecks only. `PORT=4000 npm run serve` changes the port.

## See it in a host

The [ext-apps](https://github.com/modelcontextprotocol/ext-apps) repo ships a local host, no
account needed:

```console
git clone https://github.com/modelcontextprotocol/ext-apps.git
cd ext-apps/examples/basic-host
npm install
SERVERS='["http://localhost:3002/mcp"]' npm start
```

Open <http://localhost:8080>, pick `collect_input`, paste a field spec like the one above into
**Input**, and call it. The form renders in the sandboxed iframe; submitting with a required field
empty shows the server's errors, and a valid submit posts the answers back to the conversation.

For Claude Desktop (paid plan), expose the server with `npx cloudflared tunnel --url
http://localhost:3002` and add the printed URL as a custom connector.

## Example queries that should trigger it

| What the user says | Fields the model should send |
| --- | --- |
| "Book me a flight to Lisbon next month" | departure airport `text`, outbound `date`, cabin `cards`, bags `range`, flexible `boolean` |
| "Provision a Postgres instance for staging" | region `select`, version `select`, instance size `cards`, storage `range`, backups `boolean` |
| "Set up my notification preferences" | channels `multiselect`, quiet hours `time`, digest frequency `select`, mute weekends `boolean` |
| "I want to order coffee for the team" | drink `cards`, size `select`, extras `multiselect`, count `number`, notes `textarea` |
| "Help me filter these search results" | price ceiling `range`, categories `multiselect`, in stock only `boolean`, sort by `select` |
| "Schedule a follow-up with the client" | date `date`, time `time`, duration `select`, attendees `multiselect`, agenda `textarea` |

The pattern is the same every time: the model needs several specifics before it can act, and asking
for them one at a time in prose would take as many round trips as there are fields.
