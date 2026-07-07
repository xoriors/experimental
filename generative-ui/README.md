# generative-ui

Proof of concept for generative UI in chat agents: an agent spawns temporary,
interactive UI forms inside the chat to collect structured input from the user,
instead of asking for it as free text. The collected values flow back to the agent.

Built with React, Vite and TypeScript. The agent is currently mocked; the next
step wires it to a real LLM through the AG-UI protocol and CopilotKit.

## How it works

- `src/uiSpec.ts` defines the contract: a `FormSpec` JSON shape the agent uses
  to describe a form, plus `parseFormSpec`, which validates untrusted input and
  fails with messages precise enough to feed back to the agent for a retry.
- `src/AdHocForm.tsx` renders a validated spec as a live form. Submitting
  freezes it into a read-only receipt, so the conversation moves forward and
  the past stays immutable.
- `src/App.tsx` is a chat transcript demo: the mock agent answers a booking
  request with a form, the submitted values flow back into the conversation.
  Each form message has a "view spec" toggle showing the JSON behind it.

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
