# Claude Motion prompt: pi-artifacts architecture explainer

Paste the brief below into Claude Motion. Attach `architecture.pdf` and the dashboard screenshot
(`agent-dashboard.png`) first, since Motion animates the material you give it. The follow-up edits at the end
are examples of changes that work well once the first cut is ready.

---

Make a 45-second architecture explainer for an engineering Slack channel. It will play muted, next to a demo
video of the product, so every idea must be readable on screen without narration. The viewers are engineers
who know Cloudflare and LLM agents, but not this project. Use the attached architecture PDF as the source of
truth for components, labels and numbers, and the attached screenshot for the final scene.

Style: clean technical diagram animation in landscape 16:9. Off-white background (#f7f7f5), ink text
(#1d1d1b), Inter for text and JetBrains Mono for code. Use one accent, orange (#c2410c), and use it ONLY for
the live-data path. Pale blue boxes for Durable Objects, pale green for external services. Boxes and arrows
draw themselves in; nothing bounces or spins. At most one short headline on screen at a time, plus diagram
labels.

Scenes:

1. (0–5 s) Title. "pi-artifacts" appears, then the subtitle: "Claude-style live artifacts, rebuilt on
   Cloudflare".
2. (5–12 s) The idea. A chat bubble reads "Build a live crypto dashboard". An arrow leads to a dashboard card
   with three price tiles. Headline: "An agent builds dashboards that fetch live data every time they're
   opened".
3. (12–22 s) Building. Draw the agent path in grey, left to right: Browser (Chat UI) → Worker → ChatAgent
   Durable Object (containing "Pi Durable agent", "McpHub", "Agent tools") → AI Gateway ("Claude Sonnet 5.5")
   and MCP server ("CoinGecko"). Also add R2 and "Sandbox container" beside the tools. Headline: "One Durable
   Object per chat: the agent, its MCP sessions, its cache".
4. (22–34 s) Viewing. Fade the grey path to 30 %. Draw the live-data path in orange, step by step, each label
   appearing as its arrow lands:
   "Artifact page (sandboxed, no network)" → "MessagePort" → "Viewer broker" → "POST /mcp" → "Worker" →
   "artifactCall (RPC)" → "McpHub" → "CoinGecko".
   Then show a small orange pulse travelling back along the same path. Headline: "No LLM in the live-data
   path: ~1 s, 0 tokens".
5. (34–40 s) Three guarantees, as three cards that appear one after another:
   "Manifest per version: a page can only call the tools it declared",
   "Polling timed by the server's refresh hint: within ~1 s of push",
   "Durable: Pi checkpoints every step and resumes after an eviction".
6. (40–45 s) Close on the attached dashboard screenshot. Overlay: "Workers · Durable Objects · AI Gateway · R2 ·
   Containers". End card: "pi-artifacts — prototype, deployed".

Keep every number and label exactly as written above. Don't add people, stock footage or logos that aren't
attached.

---

## Follow-up edits that work well

- "Slow down scene 4 so each orange label stays on screen for at least a second."
- "Make the headline in scene 3 shorter: 'One Durable Object per chat'."
- "Export a square 1:1 version for the Slack thumbnail." (Check the export options first: aspect-ratio support
  isn't documented.)

## Notes

- Claude Motion is in beta and available on Team and Enterprise plans. It animates text, charts, shapes and
  supplied images; it doesn't generate footage or people. You can export to MP4 or share a link.
- A longer cut (60–90 s) works the same way: add a scene between 4 and 5 that walks through the five steps in
  "How a live call travels" on page 2 of the PDF.
