# generative-ui

Proof of concept for generative UI in chat agents: an agent spawns temporary,
interactive UI forms inside the chat to collect structured input from the user,
instead of asking for it as free text. The collected values flow back to the agent.

Built with React, Vite and TypeScript. It runs in two modes over one rendering
pipeline: **live**, where Gemini decides when to spawn a form through a
CopilotKit tool call, and **mock**, a scripted agent that streams the same specs
offline.

## How it works

The core idea is generative UI: instead of asking for structured data in prose
("which city? what date? how many nights?"), the agent emits a *form*, you fill
it in, and the answers travel back as one structured payload.

### The pieces

- `server/index.ts` — a local CopilotKit runtime backed by Gemini
  (`gemini-2.5-flash`). Holds the API key so it never reaches the browser.
- `src/LiveChat.tsx` — the live loop: the chat window plus the `show_form` tool
  the model can call.
- `src/uiSpec.ts` — the contract. The `FormSpec` type and `parseFormSpec`, which
  validates untrusted JSON (from the model or the mock) one field at a time so a
  streaming spec can be checked as each line arrives.
- `src/AdHocForm.tsx` — renders a validated `FormSpec` as a live form and, once
  submitted, freezes it into a read-only receipt so the past stays immutable.
- `src/mockAgent.ts` + `src/MockDemo.tsx` — a scripted agent that drives the same
  renderer offline (a booking request produces a form, the values generate a
  second form of tailored time slots, confirming closes the loop). No key needed.
- `src/App.tsx` — toggles between the live and mock modes.

### The live flow

```text
  you type in the chat
        │
        ▼
  CopilotChat ──POST──▶ /api/copilotkit ──Vite proxy──▶ runtime :4000
  (browser :5173)                                            │
                                                 GoogleGenerativeAIAdapter
                                                             │
                                                             ▼
                                                     Gemini 2.5 Flash
                                                             │
             model decides structured input helps,          │
             calls the show_form tool  ◀────────────────────┘
        ┌──────────────┘
        ▼  tool call streams back, field by field
  parseFormSpec validates the JSON
        │                     │
   valid│                     │ invalid
        ▼                     ▼
  <AdHocForm>           error fed back to the model
  renders in chat       ("fix it and call show_form again") ──▶ retries
        │
        │  you fill it in, click Submit
        ▼
  respond(JSON.stringify(values)) ──▶ tool result ──▶ Gemini continues
```

1. You type in the chat. `CopilotChat` posts to `/api/copilotkit`, which Vite
   proxies to the local runtime; the runtime forwards to Gemini. The key stays
   server-side.
2. The model is told it can draw forms: `CHAT_INSTRUCTIONS` tells Gemini to call
   `show_form` instead of asking in prose, and `SPEC_CONTRACT` documents the JSON
   schema with an example.
3. When structured input helps, Gemini calls `show_form` with a `spec` (a JSON
   string). `parseFormSpec` validates it and `AdHocForm` draws it in the chat.
4. You submit. `AdHocForm` checks required fields and date bounds, then hands the
   values back through `respond(JSON.stringify(values))` — that string is the
   tool's return value, so Gemini sees your answers and continues the turn.

### Two ideas that make it work

- **Streaming, field by field.** A tool call's JSON arrives incrementally, so
  while it is incomplete `JSON.parse` fails and the UI shows typing dots. Once it
  parses, the form renders and grows as more fields land, unlocking for
  submission only when the call completes.
- **The model can be wrong, and self-corrects.** `parseFormSpec` treats the
  model's JSON as untrusted — `type` must be one of five, `select` needs options,
  dates must be `YYYY-MM-DD`, ids must be unique. On failure the exact error is
  fed back to the model and it retries. That same validation is what keeps
  rendering safe: every field lands in escaped React JSX, never `innerHTML` or a
  URL, so a malicious spec can't inject markup.

## Background

- https://www.copilotkit.ai/ag-ui-and-a2ui
- https://docs.ag-ui.com/introduction
- https://docs.ag-ui.com/concepts/generative-ui-specs
- https://docs.ag-ui.com/agentic-protocols

## Run

```console
pnpm install
cp .env.example .env   # add your Gemini key (free at https://aistudio.google.com)
pnpm dev:server        # terminal 1: CopilotKit runtime backed by Gemini
pnpm dev               # terminal 2: the app
```

Then open the printed local URL (default http://localhost:5173).

Two modes, same rendering pipeline:

- **Live (Gemini)**: chat freely; when the model wants structured input it
  calls the `show_form` tool with a FormSpec JSON, which is validated and
  drawn in the chat. Invalid specs are bounced back to the model with the
  exact error so it can retry.
- **Mock demo**: a scripted agent that streams the same kind of specs
  offline, no key needed.

## Scripts

- `pnpm dev` starts the frontend dev server.
- `pnpm dev:server` starts the runtime (reads `GEMINI_API_KEY` from `.env`).
- `pnpm build` type-checks and builds for production.
- `pnpm check` type-checks only.
