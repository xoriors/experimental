// `pnpm live`: a local page that watches a shared screen and speaks, with this server as the proxy that keeps the
// Liquid (and Claude) credentials out of the browser. Bound to 127.0.0.1 only.
import "../env.ts";
import { createServer } from "node:http";
import { claudeSettingsFromEnv } from "../anthropic.ts";
import { askLiquid } from "../backends/liquid.ts";
import { fromRoot } from "../env.ts";
import { createApp } from "./app.ts";
import { createNarrator } from "./narrate.ts";

const port = Number(process.env.LIVE_PORT || 5178);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`LIVE_PORT=${process.env.LIVE_PORT} is not a port number`);
if (!process.env.LIQUID_API_KEY?.trim()) console.warn("LIQUID_API_KEY is not set: the page will load, but every decision will fail (see .env.example)");

// Throws on a bad NARRATOR_VLM_EFFORT, so a typo stops the server here instead of narrating at the wrong effort.
const narrator = createNarrator({ config: claudeSettingsFromEnv() });
console.log(
	narrator.available
		? `Narrator: ${narrator.config.model}, effort ${narrator.config.effort}`
		: "Narrator: off (no ANTHROPIC_API_KEY or `ant auth login` profile found)",
);

const app = createApp({
	askLiquid,
	narrator,
	staticDir: import.meta.dirname,
	fixturesDir: fromRoot("fixtures"),
	port: () => port,
});

createServer((req, res) => void app(req, res)).listen(port, "127.0.0.1", () => {
	console.log(`Live mode: http://127.0.0.1:${port}/`);
	console.log("Warning: shared frames are sent to Liquid's cloud (and to Claude when narration is on). Share only windows with nothing private.");
});
