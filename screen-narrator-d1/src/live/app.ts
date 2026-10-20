// The live-mode HTTP handler, with its dependencies injected so tests can run it without the network.
// server.ts wires the real ones and listens; this file never reads env or opens a port.
import { readdir, readFile, realpath } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { z } from "zod";
import { claudeCostUsd, claudePriced } from "../anthropic.ts";
import { LIQUID_MODELS, type LiquidRequest, type LiquidResponse, liquidCostUsd, liquidPricePerMTok } from "../backends/liquid.ts";
import { parseDataUrl } from "../images.ts";
import { DEFAULT_THRESHOLDS, decide } from "../policy.ts";
import { CORE_QUESTIONS, noulOf, pairState, supportedQuestion, toPrediction } from "../questions.ts";
import { errorMessage, zodIssues } from "../util.ts";
import { type FrameImage, type Narrator, NarratorUnavailableError } from "./narrate.ts";

export interface LiveDeps {
	askLiquid: (req: LiquidRequest) => Promise<LiquidResponse>;
	narrator: Narrator;
	/** Holds index.html, live.css, live.js. */
	staticDir: string;
	/** The project's fixtures/ directory; may not exist. */
	fixturesDir: string;
	/** Port the server listens on, for the Host check. Undefined skips the check (tests on port 0 set it after listen). */
	port?: () => number | undefined;
}

/**
 * Liquid rejects request bodies over 4.5 MB, and the frames are forwarded as they came, so a larger body could only
 * fail upstream. The page sends downscaled JPEGs well under this.
 */
export const MAX_BODY_BYTES = 4_500_000;

/** URL path → file in staticDir; its content type comes from CONTENT_TYPES, as a fixture's does. */
const PAGE_FILES: Record<string, string> = { "/": "index.html", "/index.html": "index.html", "/live.css": "live.css", "/live.js": "live.js" };

/** By extension, for the page's files and the fixtures; a fixture of any other type is not served. */
const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".woff2": "font/woff2",
};

const PAGE_CSP = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'";

const FRAME_TYPES: readonly string[] = ["image/jpeg", "image/png"] satisfies FrameImage["mediaType"][];

/** A base64 JPEG or PNG data URL, parsed once: `url` goes to the decision model as it came, `mediaType` and `data` to Claude. */
const frame = z.string().transform((url, ctx) => {
		const parsed = parseDataUrl(url);
		if (!parsed || !FRAME_TYPES.includes(parsed.mediaType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(parsed.data)) {
			ctx.addIssue({ code: "custom", message: "must be a base64 JPEG or PNG data URL" });
			return z.NEVER;
		}
		return { url, mediaType: parsed.mediaType as FrameImage["mediaType"], data: parsed.data };
	});

const unit = z.number().min(0).max(1);
/** Any of policy.ts's Thresholds; missing ones keep DEFAULT_THRESHOLDS. */
const thresholdsBody = z.object({ announce: unit, sensitive: unit, confident: unit, supported: unit }).partial().optional();

const decideBody = z.object({
	before: frame,
	after: frame,
	model: z.enum(LIQUID_MODELS).default("d1-ultra"),
	focused: z.string().trim().max(200).optional(),
	thresholds: thresholdsBody,
});

const narrateBody = z.object({
	after: frame,
	/** The fact-check question refers to images[1], so the pair is sent when the page has it. */
	before: frame.optional(),
	model: z.enum(LIQUID_MODELS).default("d1-ultra"),
	decision: z.object({ speech: z.string().max(500) }),
	thresholds: thresholdsBody,
});

class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/**
 * Resolve `rel` inside `root`, or null if it escapes it — through `..`, an absolute path, an encoded separator or a
 * symlink. Exported for tests.
 */
export async function resolveInside(root: string, rel: string): Promise<string | null> {
	if (rel.includes("\0")) return null;
	const base = path.resolve(root);
	const target = path.resolve(base, rel);
	if (target !== base && !target.startsWith(base + path.sep)) return null;
	try {
		const [realBase, realTarget] = await Promise.all([realpath(base), realpath(target)]);
		return realTarget === realBase || realTarget.startsWith(realBase + path.sep) ? realTarget : null;
	} catch {
		return null;
	}
}

async function readBody(req: IncomingMessage): Promise<unknown> {
	const declared = Number(req.headers["content-length"]);
	if (declared > MAX_BODY_BYTES) throw new HttpError(413, `body over ${MAX_BODY_BYTES} bytes`);
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req as AsyncIterable<Buffer>) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) throw new HttpError(413, `body over ${MAX_BODY_BYTES} bytes`);
		chunks.push(chunk);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new HttpError(400, "body is not valid JSON");
	}
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
	const r = schema.safeParse(body);
	if (r.success) return r.data;
	// Only paths and messages: never echo the submitted values, which are screen images.
	throw new HttpError(400, zodIssues(r.error, "body"));
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}): void {
	res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...extra });
	res.end(body);
}

const json = (res: ServerResponse, status: number, body: unknown): void => send(res, status, JSON.stringify(body), "application/json; charset=utf-8");

/** Fixture apps, with the trigger names each registers through `fixture.on(name, fn)` (fixtures/common.js). */
async function listFixtures(dir: string): Promise<{ file: string; triggers: string[] }[]> {
	let names: string[];
	try {
		names = (await readdir(dir)).filter((n) => n.endsWith(".html")).sort();
	} catch {
		return [];
	}
	return Promise.all(
		names.map(async (file) => {
			const html = await readFile(path.join(dir, file), "utf8").catch(() => "");
			// Registrations may live in the page or in a local script it loads.
			const scripts = await Promise.all(
				[...html.matchAll(/<script[^>]*\bsrc=["']([^"':]+)["']/g)].map(async (m) => {
					const p = await resolveInside(dir, m[1] as string);
					return p ? readFile(p, "utf8").catch(() => "") : "";
				}),
			);
			return { file, triggers: extractTriggers([html, ...scripts].join("\n")) };
		}),
	);
}

/** Exported for tests. */
export function extractTriggers(src: string): string[] {
	return [...new Set([...src.matchAll(/\bfixture\.on\(\s*["'`]([\w-]+)["'`]/g)].map((m) => m[1] as string))];
}

export function createApp(deps: LiveDeps) {
	const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>> = {
		"GET /api/config": async (_req, res) =>
			json(res, 200, {
				models: LIQUID_MODELS,
				thresholds: DEFAULT_THRESHOLDS,
				narratorAvailable: deps.narrator.available,
				narratorModel: deps.narrator.config.model,
				// Models whose calls come back with a null cost, so the page can say what its total leaves out.
				unpricedModels: [
					...LIQUID_MODELS.filter((m) => liquidPricePerMTok(m) === null),
					...(claudePriced(deps.narrator.config.model) ? [] : [deps.narrator.config.model]),
				],
			}),

		"GET /api/fixtures": async (_req, res) => json(res, 200, { fixtures: await listFixtures(deps.fixturesDir) }),

		"POST /api/decide": async (req, res) => {
			const body = parse(decideBody, await readBody(req));
			const thresholds = { ...DEFAULT_THRESHOLDS, ...body.thresholds };
			const t = performance.now();
			const out = await deps.askLiquid({ model: body.model, state: pairState(body.focused), questions: CORE_QUESTIONS, images: [body.before.url, body.after.url] });
			const prediction = toPrediction(out.answers);
			json(res, 200, {
				prediction,
				decision: decide(prediction, thresholds),
				latencyMs: Math.round(performance.now() - t),
				inputTokens: out.inputTokens,
				costUsd: liquidCostUsd(body.model, out.inputTokens),
			});
		},

		"POST /api/narrate": async (req, res) => {
			if (!deps.narrator.available) return json(res, 501, { error: "narration needs Claude credentials (ANTHROPIC_API_KEY or `ant auth login`)" });
			const body = parse(narrateBody, await readBody(req));
			const thresholds = { ...DEFAULT_THRESHOLDS, ...body.thresholds };
			const t = performance.now();
			const { mediaType, data } = body.after;
			const narration = await deps.narrator.narrate({ mediaType, data }, body.decision);
			// Claude is paid even when it refuses, so its usage and cost go on every answer; costUsd is the fact-check's.
			const usage = {
				narratorInputTokens: narration.inputTokens,
				narratorOutputTokens: narration.outputTokens,
				narratorCostUsd: claudeCostUsd(narration.model, narration.inputTokens, narration.outputTokens),
			};
			if (!narration.text) {
				return json(res, 200, { narration: null, refused: narration.refused, supported: null, speak: false, latencyMs: Math.round(performance.now() - t), ...usage });
			}
			let check: LiquidResponse;
			try {
				check = await deps.askLiquid({
					model: body.model,
					state: pairState(),
					questions: { supported: supportedQuestion(narration.text) },
					images: [(body.before ?? body.after).url, body.after.url],
				});
			} catch (err) {
				// The narration was already paid for, so a failed fact-check still reports its usage.
				const message = errorMessage(err);
				console.error(`${req.method} ${req.url}: fact-check failed: ${message}`);
				return json(res, 502, { error: message, ...usage });
			}
			const supported = noulOf(check.answers, "supported");
			if (supported === undefined) {
				// The fact-check ran and was paid for, so its usage goes on the error too.
				const checkUsage = { inputTokens: check.inputTokens, costUsd: liquidCostUsd(body.model, check.inputTokens) };
				return json(res, 502, { error: `${body.model} answered the fact-check without a probability`, ...checkUsage, ...usage });
			}
			json(res, 200, {
				narration: narration.text,
				refused: false,
				supported,
				// The hallucination guard: a detail the decision model can't see on screen is never spoken.
				speak: supported >= thresholds.supported,
				latencyMs: Math.round(performance.now() - t),
				inputTokens: check.inputTokens,
				costUsd: liquidCostUsd(body.model, check.inputTokens),
				...usage,
			});
		},
	};

	async function serveFixture(rel: string, res: ServerResponse): Promise<void> {
		let decoded: string;
		try {
			decoded = decodeURIComponent(rel);
		} catch {
			throw new HttpError(400, "bad path");
		}
		const type = CONTENT_TYPES[path.extname(decoded).toLowerCase()];
		const file = type && (await resolveInside(deps.fixturesDir, decoded));
		if (!type || !file) throw new HttpError(404, "not found");
		const data = await readFile(file).catch(() => {
			throw new HttpError(404, "not found");
		});
		send(res, 200, data, type);
	}

	return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			// The server spends money with a key the browser never sees, so only this machine's own pages may use it:
			// a Host check stops DNS rebinding, and requiring JSON forces a CORS preflight that other origins fail.
			const port = deps.port?.();
			const host = req.headers.host ?? "";
			if (port !== undefined && host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, "unexpected Host header");
			if (req.method === "POST" && !String(req.headers["content-type"] ?? "").startsWith("application/json")) {
				throw new HttpError(415, "expected application/json");
			}

			const url = new URL(req.url ?? "/", "http://localhost");
			const route = routes[`${req.method} ${url.pathname}`];
			if (route) return await route(req, res);

			if (req.method === "GET" || req.method === "HEAD") {
				const page = PAGE_FILES[url.pathname];
				if (page) return send(res, 200, await readFile(path.join(deps.staticDir, page)), CONTENT_TYPES[path.extname(page)]!, { "Content-Security-Policy": PAGE_CSP });
				if (url.pathname.startsWith("/fixtures/")) return await serveFixture(url.pathname.slice("/fixtures/".length), res);
			}
			throw new HttpError(404, "not found");
		} catch (err) {
			if (err instanceof HttpError) return json(res, err.status, { error: err.message });
			if (err instanceof NarratorUnavailableError) return json(res, 501, { error: `narration unavailable: ${err.message}` });
			// Upstream failure (a decision model or Claude). The message is safe to show; request bodies are never logged.
			const message = errorMessage(err);
			console.error(`${req.method} ${req.url}: ${message}`);
			if (!res.headersSent) json(res, 502, { error: message });
		}
	};
}
