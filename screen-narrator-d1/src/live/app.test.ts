import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiquidRequest, LiquidResponse } from "../backends/liquid.ts";
import { createApp, extractTriggers, MAX_BODY_BYTES, resolveInside } from "./app.ts";
import type { Narration, Narrator } from "./narrate.ts";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const JPEG = "data:image/jpeg;base64,/9j/4AAQ";

// The answer shape Liquid returned for the smoke test.
const ANSWERS = {
	announce: { noul: 0.91 },
	kind: { choice: "dialog", confidence: 0.88, probabilities: { dialog: 0.88, error: 0.05, none: 0.07 } },
	urgency: { score: 2.9, confidence: 0.8, probabilities: { "0": 0.02, "1": 0.03, "2": 0.1, "3": 0.85 } },
	sensitive: { noul: 0.03 },
};

const tmp = mkdtempSync(path.join(os.tmpdir(), "live-test-"));
const fixturesDir = path.join(tmp, "fixtures");
const staticDir = path.join(tmp, "static");
mkdirSync(fixturesDir);
mkdirSync(staticDir);
writeFileSync(path.join(fixturesDir, "mail.html"), "<p>mail</p><script>fixture.on('confirm-dialog', () => {}); fixture.on(\"toast\", () => {});</script>");
writeFileSync(path.join(fixturesDir, "chat.html"), `<script src="chat.js"></script><script src="../outside.js"></script>`);
writeFileSync(path.join(fixturesDir, "chat.js"), "fixture.on('new-message', () => {});");
writeFileSync(path.join(tmp, "outside.js"), "fixture.on('leaked', () => {});");
writeFileSync(path.join(tmp, "secret.txt"), "outside");
symlinkSync(path.join(tmp, "secret.txt"), path.join(fixturesDir, "link.html"));
writeFileSync(path.join(staticDir, "index.html"), "<h1>live</h1>");
writeFileSync(path.join(staticDir, "live.js"), "1");
writeFileSync(path.join(staticDir, "live.css"), "a{}");
writeFileSync(path.join(staticDir, "server.ts"), "secret source");

const askLiquid = vi.fn<(req: LiquidRequest) => Promise<LiquidResponse>>();
let narratorAvailable = true;
const narrate = vi.fn<Narrator["narrate"]>();
const narrator: Narrator = {
	get available() {
		return narratorAvailable;
	},
	config: { model: "claude-opus-5-5", effort: "low" },
	narrate,
};

let server: Server;
let base: string;
let port: number | undefined;

beforeAll(async () => {
	server = createServer(createApp({ askLiquid, narrator, staticDir, fixturesDir, port: () => port }));
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	port = (server.address() as AddressInfo).port;
	base = `http://127.0.0.1:${port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
	askLiquid.mockReset();
	narrate.mockReset();
	narratorAvailable = true;
});

const post = (route: string, body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
	fetch(base + route, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("static and fixtures", () => {
	it("serves the page with a CSP, and only the allowlisted files", async () => {
		const page = await fetch(`${base}/`);
		expect(page.status).toBe(200);
		expect(page.headers.get("content-type")).toMatch(/^text\/html/);
		expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
		expect((await fetch(`${base}/live.js`)).headers.get("content-type")).toMatch(/javascript/);
		expect((await fetch(`${base}/server.ts`)).status).toBe(404);
	});

	it("serves fixtures with their content type", async () => {
		const res = await fetch(`${base}/fixtures/mail.html`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/^text\/html/);
		expect(await res.text()).toContain("mail");
	});

	it.each(["/fixtures/../secret.txt", "/fixtures/%2e%2e/secret.txt", "/fixtures/..%2fsecret.txt", "/fixtures/%2fetc%2fpasswd", "/fixtures/link.html", "/fixtures/nope.html"])(
		"refuses %s",
		async (p) => {
			const res = await fetch(base + p);
			expect([400, 404]).toContain(res.status);
			expect(await res.text()).not.toContain("outside");
		},
	);

	it("resolveInside keeps paths in the root", async () => {
		expect(await resolveInside(fixturesDir, "mail.html")).toBe(path.join(fixturesDir, "mail.html"));
		expect(await resolveInside(fixturesDir, "../secret.txt")).toBeNull();
		expect(await resolveInside(fixturesDir, "/etc/passwd")).toBeNull();
		expect(await resolveInside(fixturesDir, "link.html")).toBeNull();
		expect(await resolveInside(fixturesDir, "a\0b")).toBeNull();
	});

	it("lists fixtures with their trigger names", async () => {
		const body = (await (await fetch(`${base}/api/fixtures`)).json()) as { fixtures: { file: string; triggers: string[] }[] };
		expect(body.fixtures.find((f) => f.file === "mail.html")?.triggers).toEqual(["confirm-dialog", "toast"]);
		// From a local script the page loads, but never from one outside the fixtures folder.
		expect(body.fixtures.find((f) => f.file === "chat.html")?.triggers).toEqual(["new-message"]);
	});

	it("extractTriggers reads fixture.on registrations once each", () => {
		expect(extractTriggers("fixture.on(`saved-toast`, f); window.fixture.on( 'scroll', g); fixture.on('scroll', h)")).toEqual(["saved-toast", "scroll"]);
		expect(extractTriggers("nothing here")).toEqual([]);
	});
});

describe("request guards", () => {
	it("rejects a foreign Host header (DNS rebinding)", async () => {
		const res = await new Promise<number>((resolve, reject) => {
			import("node:http").then(({ request }) => {
				const req = request({ host: "127.0.0.1", port, path: "/api/config", headers: { Host: `evil.example:${port}` } }, (r) => resolve(r.statusCode ?? 0));
				req.on("error", reject);
				req.end();
			});
		});
		expect(res).toBe(403);
	});

	it("requires a JSON content type on POST", async () => {
		const res = await post("/api/decide", { before: PNG, after: PNG }, { "Content-Type": "text/plain" });
		expect(res.status).toBe(415);
	});

	it("rejects invalid JSON", async () => {
		const res = await post("/api/decide", "{nope");
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "body is not valid JSON" });
	});

	it("rejects bad image data without echoing it", async () => {
		const res = await post("/api/decide", { before: "data:image/gif;base64,R0lGOD", after: PNG });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/^before: /);
		expect(body.error).not.toContain("R0lGOD");
		expect(askLiquid).not.toHaveBeenCalled();
	});

	it("rejects an unknown model and out-of-range thresholds", async () => {
		expect((await post("/api/decide", { before: PNG, after: PNG, model: "gpt" })).status).toBe(400);
		expect((await post("/api/decide", { before: PNG, after: PNG, thresholds: { announce: 2 } })).status).toBe(400);
		expect((await post("/api/narrate", { after: PNG, decision: { speech: "x" }, thresholds: { supported: -0.1 } })).status).toBe(400);
	});

	it("rejects a body over the cap with 413", async () => {
		const big = `data:image/jpeg;base64,${"A".repeat(MAX_BODY_BYTES)}`;
		const res = await post("/api/decide", { before: big, after: big });
		expect(res.status).toBe(413);
	});

	it("returns JSON 404 for unknown routes", async () => {
		const res = await fetch(`${base}/api/nope`);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "not found" });
	});
});

describe("GET /api/config", () => {
	it("reports models, thresholds, the narrator and which models are unpriced", async () => {
		narratorAvailable = false;
		vi.stubEnv("LIQUID_D1_USD_PER_MTOK", "");
		const body = await (await fetch(`${base}/api/config`)).json();
		vi.unstubAllEnvs();
		expect(body).toEqual({
			models: ["d1-ultra", "d1"],
			thresholds: { announce: 0.5, sensitive: 0.5, confident: 0.8, supported: 0.5 },
			narratorAvailable: false,
			narratorModel: "claude-opus-5-5",
			unpricedModels: ["d1"],
		});
	});

	it("drops d1 from the unpriced list once its price is set", async () => {
		vi.stubEnv("LIQUID_D1_USD_PER_MTOK", "0.03");
		const body = (await (await fetch(`${base}/api/config`)).json()) as { unpricedModels: string[] };
		vi.unstubAllEnvs();
		expect(body.unpricedModels).toEqual([]);
	});
});

describe("POST /api/decide", () => {
	it("asks the live questions about the pair and returns the decision", async () => {
		askLiquid.mockResolvedValue({ answers: ANSWERS, inputTokens: 1000 });
		const res = await post("/api/decide", { before: PNG, after: JPEG, focused: 'button "Delete"' });
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.decision).toEqual({ action: "interrupt", narratable: true, speech: "Dialog opened", reason: expect.stringContaining("kind=dialog") });
		expect(body.prediction).toMatchObject({ announce: 0.91, sensitive: 0.03, kind: { choice: "dialog" } });
		expect(body.inputTokens).toBe(1000);
		expect(body.costUsd).toBeCloseTo(0.000042);
		expect(typeof body.latencyMs).toBe("number");

		const req = askLiquid.mock.calls[0]![0];
		expect(req.model).toBe("d1-ultra");
		expect(req.images).toEqual([PNG, JPEG]);
		expect(Object.keys(req.questions)).toEqual(["announce", "kind", "urgency", "sensitive"]);
		expect(req.state.focused).toContain('button "Delete"');
	});

	it("applies the page's thresholds over the defaults", async () => {
		askLiquid.mockResolvedValue({ answers: ANSWERS, inputTokens: 10 });
		const body = (await (await post("/api/decide", { before: PNG, after: PNG, thresholds: { announce: 0.95 } })).json()) as { decision: { action: string } };
		expect(body.decision.action).toBe("drop");
	});

	it("reports an unknown d1 price as null", async () => {
		vi.stubEnv("LIQUID_D1_USD_PER_MTOK", "");
		askLiquid.mockResolvedValue({ answers: ANSWERS, inputTokens: 10 });
		const body = (await (await post("/api/decide", { before: PNG, after: PNG, model: "d1" })).json()) as { costUsd: unknown };
		expect(body.costUsd).toBeNull();
		vi.unstubAllEnvs();
	});

	it("turns a Liquid failure into a 502 JSON error", async () => {
		askLiquid.mockRejectedValue(new Error("Liquid said no"));
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const res = await post("/api/decide", { before: PNG, after: PNG });
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({ error: "Liquid said no" });
		expect(String(spy.mock.calls[0]?.[0])).not.toContain("base64");
		spy.mockRestore();
	});
});

describe("POST /api/narrate", () => {
	const narration = (text: string | null, refused = false, model = "claude-opus-5-5"): Narration => ({ text, refused, model, inputTokens: 1500, outputTokens: 40 });
	// claude-opus-5-5 at $4 / $20 per million tokens.
	const NARRATION_COST = (1500 * 4 + 40 * 20) / 1e6;

	it("is 501 without Claude credentials", async () => {
		narratorAvailable = false;
		const res = await post("/api/narrate", { after: PNG, decision: { speech: "Dialog opened" } });
		expect(res.status).toBe(501);
		expect(narrate).not.toHaveBeenCalled();
	});

	it("fact-checks the narration against the after frame", async () => {
		narrate.mockResolvedValue(narration("Dialog: Delete 3 messages? Buttons Cancel and Delete"));
		askLiquid.mockResolvedValue({ answers: { supported: { noul: 0.83 } }, inputTokens: 500 });
		const res = await post("/api/narrate", { before: PNG, after: JPEG, decision: { speech: "Dialog opened" } });
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toMatchObject({ narration: "Dialog: Delete 3 messages? Buttons Cancel and Delete", supported: 0.83, speak: true, refused: false, inputTokens: 500 });
		expect(body.costUsd).toBeCloseTo(0.000021);
		expect(body.narratorCostUsd).toBeCloseTo(NARRATION_COST, 12);

		expect(narrate.mock.calls[0]![0]).toEqual({ mediaType: "image/jpeg", data: "/9j/4AAQ" });
		const req = askLiquid.mock.calls[0]![0];
		expect(Object.keys(req.questions)).toEqual(["supported"]);
		expect(JSON.stringify(req.questions)).toContain("Delete 3 messages");
		// The question names images[1], so the after frame must be second.
		expect(req.images).toEqual([PNG, JPEG]);
	});

	it("uses the after frame twice when no before frame is sent", async () => {
		narrate.mockResolvedValue(narration("Error: Email is required"));
		askLiquid.mockResolvedValue({ answers: { supported: { noul: 0.2 } }, inputTokens: 500 });
		const body = await (await post("/api/narrate", { after: PNG, decision: { speech: "Error on the screen" } })).json();
		expect(askLiquid.mock.calls[0]![0].images).toEqual([PNG, PNG]);
		// Below the default supported threshold (0.5): logged, not spoken.
		expect(body).toMatchObject({ supported: 0.2, speak: false });
	});

	it("decides speak with the page's supported threshold", async () => {
		narrate.mockResolvedValue(narration("New message from Ana"));
		askLiquid.mockResolvedValue({ answers: { supported: { noul: 0.83 } }, inputTokens: 500 });
		const strict = await (await post("/api/narrate", { after: PNG, decision: { speech: "x" }, thresholds: { supported: 0.9 } })).json();
		expect(strict).toMatchObject({ supported: 0.83, speak: false });
	});

	it("skips the fact-check when Claude refused, but still prices the Claude call", async () => {
		narrate.mockResolvedValue(narration(null, true));
		const body = (await (await post("/api/narrate", { after: PNG, decision: { speech: "x" } })).json()) as Record<string, unknown>;
		expect(body).toMatchObject({ narration: null, refused: true, supported: null, speak: false, narratorInputTokens: 1500, narratorOutputTokens: 40 });
		expect(body.narratorCostUsd).toBeCloseTo(NARRATION_COST, 12);
		expect(askLiquid).not.toHaveBeenCalled();
	});

	it("prices the narration at the model that answered, null when that model is unknown", async () => {
		narrate.mockResolvedValue(narration("Dialog opened", false, "claude-opus-4-8"));
		askLiquid.mockResolvedValue({ answers: { supported: { noul: 0.9 } }, inputTokens: 500 });
		const fallback = (await (await post("/api/narrate", { after: PNG, decision: { speech: "x" } })).json()) as Record<string, unknown>;
		expect(fallback.narratorCostUsd).toBeCloseTo((1500 * 5 + 40 * 25) / 1e6, 12);

		narrate.mockResolvedValue(narration("Dialog opened", false, "claude-unknown-9"));
		const unknown = (await (await post("/api/narrate", { after: PNG, decision: { speech: "x" } })).json()) as Record<string, unknown>;
		expect(unknown.narratorCostUsd).toBeNull();
	});

	it("is 502 when the fact-check answer has no probability", async () => {
		narrate.mockResolvedValue(narration("Something"));
		askLiquid.mockResolvedValue({ answers: { supported: {} }, inputTokens: 1 });
		expect((await post("/api/narrate", { after: PNG, decision: { speech: "x" } })).status).toBe(502);
	});

	it("still reports the paid narration's usage when the fact-check call fails", async () => {
		narrate.mockResolvedValue(narration("Something"));
		askLiquid.mockRejectedValue(new Error("Liquid said no"));
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const res = await post("/api/narrate", { after: PNG, decision: { speech: "x" } });
		expect(res.status).toBe(502);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toMatchObject({ error: "Liquid said no", narratorInputTokens: 1500, narratorOutputTokens: 40 });
		expect(body.narratorCostUsd).toBeCloseTo(NARRATION_COST, 12);
		spy.mockRestore();
	});
});
