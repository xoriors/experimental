# Diagrams

Sources are the `.mmd` files; the `.svg` files are pre-rendered so they show in any viewer. To re-render after
editing one (uses the system Chrome, no Puppeteer download):

```bash
cd docs
PUPPETEER_SKIP_DOWNLOAD=1 npx -y @mermaid-js/mermaid-cli -p pptr.json -i pipeline.mmd -o pipeline.svg
```

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
