// Synthetic runs with invented ids: small builders for the metrics tests, and `sampleRun()` for `pnpm report --sample`
// so the report's layout can be seen (and worked on) before any real benchmark has run. No real data or images.
import { type Scenario, SCENARIOS } from "../../fixtures/scenarios.ts";
import { claudeCostUsd, claudeImageTokens, DEFAULT_CLAUDE_MODEL } from "../anthropic.ts";
import { liquidCostUsd, liquidEstimate, type LiquidModel } from "../backends/liquid.ts";
import { announceScore, DEFAULT_PIXEL_DIFF_THRESHOLD } from "../backends/pixel-diff.ts";
import {
	AMBIGUOUS,
	CHANGE_KINDS,
	type ChangeKind,
	type Pair,
	type PairLabels,
	type PairResult,
	type Prediction,
	type RunResult,
	variantSlug,
} from "../types.ts";

export function makePair(id: string, labels: Partial<PairLabels> = {}, extra: Partial<Pair> = {}): Pair {
	return {
		id,
		scenario: extra.scenario ?? "test-scenario",
		app: extra.app ?? "test",
		variant: { theme: "light", viewport: { width: 1280, height: 800 }, density: "comfortable", lang: "en" },
		before: `data/sample/${id}/before.png`,
		after: `data/sample/${id}/after.png`,
		width: 1280,
		height: 800,
		...extra,
		labels: { announce: true, kind: "dialog", urgency: 3, sensitive: false, ...labels },
	};
}

export function makeResult(pairId: string, backend: string, prediction: Prediction | undefined, extra: Partial<PairResult> = {}): PairResult {
	return { pairId, backend, prediction, latencyMs: 100, ...extra };
}

export function makeRun(pairs: Pair[], results: PairResult[], backends?: string[]): RunResult {
	return {
		id: "test-run",
		createdAt: "2026-01-01T00:00:00.000Z",
		backends: backends ?? [...new Set(results.map((r) => r.backend))],
		questionSet: "core",
		pairs,
		results,
	};
}

/** A one-hot-ish kind answer: `p` on the choice, the rest spread evenly. */
export function kindAnswer(choice: ChangeKind, p: number): NonNullable<Prediction["kind"]> {
	const rest = (1 - p) / (CHANGE_KINDS.length - 1);
	return { choice, probabilities: Object.fromEntries(CHANGE_KINDS.map((k) => [k, k === choice ? p : rest])) };
}

// --- the --sample run --------------------------------------------------------------------------------------------

/** mulberry32: a tiny seeded PRNG, so the sample report is the same every time. */
function rng(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// The real scenarios (fixtures/scenarios.ts) with their labels; this is only the share of the screen each one changes,
// which is what fools pixel diff. Invented, but in proportion; every scenario must have one.
const PIXEL_SHARE: Record<string, number> = {
	"confirm-dialog": 0.35,
	"session-expiry": 0.3,
	"validation-error": 0.02,
	"saved-toast": 0.015,
	"new-message": 0.04,
	"open-message": 0.8,
	"cookie-banner": 0.12,
	"infinite-scroll": 0.25,
	"user-scroll": 0.7,
	"hover-card": 0.06,
	"spinner-frame": 0.004,
	"clock-tick": 0.001,
	"rotating-ad": 0.09,
	"no-change": 0,
	"card-declined": 0.03,
	"password-reveal": 0.008,
	"dark-mode-toggle": 0.95,
};
const scenarioById = (id: string): Scenario => {
	const s = SCENARIOS.find((x) => x.id === id);
	if (!s) throw new Error(`sample: no scenario "${id}" in fixtures/scenarios.ts`);
	return s;
};
const pixelShare = (id: string): number => {
	const px = PIXEL_SHARE[id];
	if (px === undefined) throw new Error(`sample: no pixel share for scenario "${id}"`);
	return px;
};
const VARIANTS: Pair["variant"][] = [
	{ theme: "light", viewport: { width: 1280, height: 800 }, density: "comfortable", lang: "en" },
	{ theme: "dark", viewport: { width: 1280, height: 800 }, density: "compact", lang: "en" },
	{ theme: "light", viewport: { width: 390, height: 844 }, density: "comfortable", lang: "es" },
	{ theme: "dark", viewport: { width: 768, height: 1024 }, density: "comfortable", lang: "en" },
];

const clamp = (x: number) => Math.min(0.995, Math.max(0.005, x));

/** Each fake backend's personality: how sharp, how biased, how often it confuses kinds. */
interface Persona {
	name: string;
	/** Probability mass the true answer gets, before noise. */
	skill: number;
	/** How far apart yes and no answers sit (U-shaped probabilities when > 1). */
	separation: number;
	/** Pushes probabilities towards 0 / 1 (overconfidence) when > 1. */
	sharpen: number;
	latency: [number, number];
	/** Input and output tokens for a pair, before jitter. */
	tokens: (pair: Pair) => [input: number, output: number];
	/** The backend's own pricing (d1's is unknown unless LIQUID_D1_USD_PER_MTOK is set). */
	costUsd: (inputTokens: number, outputTokens: number) => number | null;
	errorRate: number;
}
const liquid = (model: LiquidModel): Pick<Persona, "name" | "tokens" | "costUsd"> => ({
	name: model,
	tokens: (pair) => [liquidEstimate(model, pair, "core").inputTokens, 0],
	costUsd: (input) => liquidCostUsd(model, input),
});
const PERSONAS: Persona[] = [
	{ ...liquid("d1-ultra"), skill: 0.86, separation: 3, sharpen: 1, latency: [620, 260], errorRate: 0.01 },
	{ ...liquid("d1"), skill: 0.74, separation: 2, sharpen: 1.6, latency: [310, 140], errorRate: 0.01 },
	{
		name: "vlm",
		skill: 0.8,
		separation: 2.5,
		sharpen: 3,
		latency: [2900, 1600],
		// Both images plus the prompt, and the answer: the shape of vlm.ts's own estimate.
		tokens: (pair) => [2 * claudeImageTokens(pair.width, pair.height) + 900, 600],
		costUsd: (input, output) => claudeCostUsd(DEFAULT_CLAUDE_MODEL, input, output),
		errorRate: 0.04,
	},
];

function sharpenP(p: number, k: number): number {
	const a = p ** k;
	return a / (a + (1 - p) ** k);
}

function predict(persona: Persona, labels: PairLabels, rand: () => number): Prediction {
	// Rejection sampling makes P(truth | p) = p (calibrated, for balanced classes); `sharpen` then distorts it.
	const truthful = (truth: boolean) => {
		for (;;) {
			const p = sharpenP(rand(), persona.separation);
			if (rand() < (truth ? p : 1 - p)) return clamp(sharpenP(p, persona.sharpen));
		}
	};
	const announceTruth = labels.announce === AMBIGUOUS ? rand() < 0.5 : labels.announce;
	const kindTruth: ChangeKind = labels.kind === AMBIGUOUS ? "cosmetic" : labels.kind;
	const right = rand() < persona.skill + 0.05;
	const choice = right ? kindTruth : CHANGE_KINDS[Math.floor(rand() * CHANGE_KINDS.length)]!;
	const top = clamp(sharpenP(0.45 + rand() * 0.45, persona.sharpen));
	const urgencyTruth = labels.urgency === AMBIGUOUS ? 1 : labels.urgency;
	const urgencyScore = Math.min(3, Math.max(0, urgencyTruth + (rand() - 0.5) * 2 * (1.6 - persona.skill) + (rand() < 0.06 ? 1.4 : 0)));
	const levels = [0, 1, 2, 3].map((l) => Math.exp(-((l - urgencyScore) ** 2) * 1.5));
	const z = levels.reduce((a, b) => a + b, 0);
	return {
		announce: truthful(announceTruth),
		kind: kindAnswer(choice, top),
		urgency: { score: urgencyScore, probabilities: { 0: levels[0]! / z, 1: levels[1]! / z, 2: levels[2]! / z, 3: levels[3]! / z } },
		sensitive: truthful(labels.sensitive),
	};
}

/**
 * 88 invented pairs (the 17 real transitions × 4 variants, plus a 2-minute session) answered by fake d1-ultra, d1,
 * pixel-diff and VLM backends.
 */
export function sampleRun(): RunResult {
	const rand = rng(20261015);
	const { pairs, pixels } = buildSyntheticPairs(rand);
	return answerAll(pairs, pixels, rand);
}

/** The pairs, and the share of each pair's pixels that changed (what the sample pixel-diff answers from). */
function buildSyntheticPairs(rand: () => number): { pairs: Pair[]; pixels: Map<string, number> } {
	const pairs: Pair[] = [];
	const pixels = new Map<string, number>();
	for (const { id: name, app, labels } of SCENARIOS)
		for (const variant of VARIANTS) {
			const id = `${app}-${name}--${variantSlug(variant)}`;
			pairs.push({
				...makePair(id, { ...labels }, { scenario: name, app, variant }),
				width: variant.viewport.width,
				height: variant.viewport.height,
				focused: labels.kind === "dialog" ? 'button "Cancel"' : undefined,
			});
			pixels.set(id, pixelShare(name) * (0.7 + rand() * 0.6));
		}
	// A scripted session: mostly quiet frames with a few events, 6 s apart.
	const script = [
		"no-change", "spinner-frame", "no-change", "hover-card", "saved-toast", "no-change", "spinner-frame", "user-scroll", "user-scroll", "confirm-dialog",
		"no-change", "spinner-frame", "new-message", "no-change", "hover-card", "spinner-frame", "no-change", "open-message", "user-scroll", "validation-error",
	].map(scenarioById);
	script.forEach(({ id: name, app, labels }, step) => {
		const id = `session-mail-morning--${String(step).padStart(2, "0")}-${name}`;
		pairs.push(makePair(id, { ...labels }, { scenario: name, app, session: { name: "mail-morning", step, tMs: step * 6000 } }));
		pixels.set(id, pixelShare(name) * (0.7 + rand() * 0.6));
	});
	return { pairs, pixels };
}

function answerAll(pairs: Pair[], pixels: Map<string, number>, rand: () => number): RunResult {
	const results: PairResult[] = [];
	for (const pair of pairs) {
		for (const persona of PERSONAS) {
			const latencyMs = Math.round(persona.latency[0] + (rand() - 0.3) * persona.latency[1]);
			if (rand() < persona.errorRate) {
				results.push(makeResult(pair.id, persona.name, undefined, { error: "HTTP 503: upstream timed out", latencyMs: 30_000 }));
				continue;
			}
			const [input, outputTokens] = persona.tokens(pair);
			const inputTokens = Math.round(input * (0.9 + rand() * 0.2));
			results.push(
				makeResult(pair.id, persona.name, predict(persona, pair.labels, rand), {
					latencyMs,
					inputTokens,
					outputTokens,
					costUsd: persona.costUsd(inputTokens, outputTokens),
					cached: rand() < 0.15,
				}),
			);
		}
		// Pixel diff answers exactly as the real backend would from the changed share.
		const share = pixels.get(pair.id) ?? 0;
		const announce = announceScore(share, DEFAULT_PIXEL_DIFF_THRESHOLD);
		results.push(makeResult(pair.id, "pixel-diff", { announce }, { latencyMs: 4 + Math.round(rand() * 6), costUsd: 0 }));
	}
	return { id: "sample", createdAt: "2026-10-19T12:00:00.000Z", backends: ["d1-ultra", "d1", "pixel-diff", "vlm"], questionSet: "core", pairs, results };
}
