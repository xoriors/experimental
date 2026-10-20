// The shared contracts: what capture writes (Pair), what a backend returns (Prediction), and what a benchmark run
// stores (RunResult). Every module reads and writes these shapes and nothing else, so keep them in one place.

export const CHANGE_KINDS = ["dialog", "error", "notification", "navigation", "content", "scroll", "cosmetic", "none"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** Urgency levels, indexed like the `urgency` score rubric in questions.ts. */
export const URGENCY_LEVELS = ["drop", "mention", "queue", "interrupt"] as const;
export type Urgency = 0 | 1 | 2 | 3;

/** A label people could reasonably disagree on: shown in the report, left out of accuracy. */
export const AMBIGUOUS = "ambiguous" as const;
export type Ambiguous = typeof AMBIGUOUS;

/** Ground truth for one before/after pair, known because the script that produced the change says so. */
export interface PairLabels {
	announce: boolean | Ambiguous;
	kind: ChangeKind | Ambiguous;
	urgency: Urgency | Ambiguous;
	/** Does the AFTER screen show a password, card or bank details, private messages, health or ID documents? */
	sensitive: boolean;
	/** For the `primary` question: candidate elements (label → description, from the accessibility tree) and the right one. */
	primary?: { candidates: Record<string, string>; answer: string };
	/** For the `supported` question: one narration true to the AFTER screen and one with an invented detail. */
	narrations?: { supported: string; unsupported: string };
}

export interface Variant {
	theme: "light" | "dark";
	viewport: { width: number; height: number };
	density: "comfortable" | "compact";
	lang: "en" | "es";
}

export interface Pair {
	/** Unique and filesystem-safe, e.g. `mail-confirm-dialog--dark-1280x800-compact-en`. */
	id: string;
	/** The transition that produced it (fixtures/scenarios.ts). */
	scenario: string;
	/** The fixture app it ran in, e.g. `mail`. */
	app: string;
	variant: Variant;
	/** Paths relative to the project root, e.g. `data/pairs/<id>/before.png`. */
	before: string;
	after: string;
	width: number;
	height: number;
	/** The control with keyboard focus in the AFTER screen, as the accessibility tree names it (e.g. `button "Delete"`). */
	focused?: string;
	/** Set on pairs that are consecutive frames of a scripted session (noise metric). */
	session?: { name: string; step: number; tMs: number };
	labels: PairLabels;
}

/** What a backend answered. A field is absent when the backend can't answer that question (e.g. pixel diff). */
export interface Prediction {
	/** P(announce). */
	announce?: number;
	kind?: { choice: ChangeKind; probabilities: Partial<Record<ChangeKind, number>> };
	/** Expected urgency level (0–3, may fall between levels) and per-level probabilities. */
	urgency?: { score: number; probabilities: Partial<Record<`${Urgency}`, number>> };
	/** P(sensitive). */
	sensitive?: number;
	primary?: { choice: string; probabilities: Record<string, number> };
	/** P(narration is supported by the AFTER screen), for the true and the invented narration. */
	supported?: { supported: number; unsupported: number };
}

export interface PairResult {
	pairId: string;
	backend: string;
	prediction?: Prediction;
	error?: string;
	latencyMs: number;
	inputTokens?: number;
	outputTokens?: number;
	/** Null when the price of the model is unknown. */
	costUsd?: number | null;
	/** True when served from runs/cache instead of a fresh API call. */
	cached?: boolean;
}

export interface RunResult {
	id: string;
	createdAt: string;
	backends: string[];
	questionSet: QuestionSet;
	/** Copied in full so a run is self-contained even if data/ is regenerated. */
	pairs: Pair[];
	results: PairResult[];
}

/** `core` = announce, kind, urgency, sensitive. `all` adds primary and supported where the pair has those labels. */
export type QuestionSet = "core" | "all";
