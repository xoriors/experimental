# generative-ui

Proof of concept for generative UI in chat agents: an agent spawns temporary,
interactive UI forms inside the chat to collect structured input from the user,
instead of asking for it as free text. The collected values flow back to the agent.

Built with React, Vite and TypeScript. The agent is currently mocked; the next
step wires it to a real LLM through the AG-UI protocol and CopilotKit.

## How it works

- `src/uiSpec.ts` defines the contract: a `FormSpec` JSON shape the agent uses
  to describe a form. `parseFormField` validates each field line on its own
  (specs stream JSONL style, one field at a time) and `parseFormSpec` validates
  whole specs. Errors are precise enough to feed back to the agent for a retry.
- `src/mockAgent.ts` simulates the agent as an event stream, the shape AG-UI
  actually delivers: typing, text, then a form that arrives field by field.
  Swapping it for a real LLM behind AG-UI only changes the event source.
- `src/AdHocForm.tsx` renders a spec as a live form, growing while it streams.
  Submitting freezes it into a read-only receipt, so the conversation moves
  forward and the past stays immutable.
- `src/App.tsx` drives a multi-turn conversation: a booking request produces a
  form, the submitted values make the agent generate a second form (time slots
  tailored to those values), and confirming closes the loop. Each form has a
  "view spec" toggle showing the JSON behind it.

## Background

- https://www.copilotkit.ai/ag-ui-and-a2ui
- https://docs.ag-ui.com/introduction
- https://docs.ag-ui.com/concepts/generative-ui-specs
- https://docs.ag-ui.com/agentic-protocols

## Run

```console
pnpm install
pnpm dev
```

Then open the printed local URL (default http://localhost:5173).

## Scripts

- `pnpm dev` starts the dev server.
- `pnpm build` type-checks and builds for production.
- `pnpm check` type-checks only.
