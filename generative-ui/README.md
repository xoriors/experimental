# generative-ui

Proof of concept for generative UI in chat agents: an agent spawns temporary,
interactive UI forms inside the chat to collect structured input from the user,
instead of asking for it as free text. The collected values flow back to the agent.

Built with React, Vite and TypeScript, using the AG-UI protocol and CopilotKit.

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
