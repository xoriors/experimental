# Diagrams

Sources are the `.mmd` files; the `.svg` files are pre-rendered so they show in any viewer. To re-render all of
them after editing one (uses the system Chrome via `pptr.json`, no Puppeteer download; `mermaid.json` sets Arial,
so no font is embedded in the SVGs):

```bash
pnpm diagrams
```

`pptr.json` points at `/usr/bin/google-chrome-stable`. On a machine with Chrome or Chromium elsewhere, change its
`executablePath` (or delete the file and the `-p docs/pptr.json` flag, and drop `PUPPETEER_SKIP_DOWNLOAD=1` so
mermaid-cli downloads its own browser).

## Pipeline: capture → bench → report, and live mode

![Pipeline](pipeline.svg)

Source: [`pipeline.mmd`](pipeline.mmd)

## Decision policy: from probabilities to speak or stay silent

`src/policy.ts` `decide()`; the thresholds are `DEFAULT_THRESHOLDS` there.

![Decision policy](decision.svg)

Source: [`decision.mmd`](decision.mmd)

## Live mode: one change, from screen to speech

`src/live/live.js` (page), `src/live/app.ts` (server), `src/live/narrate.ts` (Claude).

![Live mode](live-mode.svg)

Source: [`live-mode.mmd`](live-mode.mmd)
