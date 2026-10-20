// Turns a Prediction into what a screen narrator would do: interrupt, queue, mention-on-ask or drop, and the words
// it would say. Live mode speaks with it; the noise metric counts with it. Thresholds are the experiment knobs.
import { type ChangeKind, type Prediction, type Urgency, URGENCY_LEVELS } from "./types.ts";

export interface Thresholds {
	/** Announce only when P(announce) is at least this. */
	announce: number;
	/** Never narrate the content of a screen whose P(sensitive) is at least this. */
	sensitive: number;
	/** Hedge ("probably …") when the kind's probability is below this. */
	confident: number;
	/** Speak a generated narration only when P(it is supported by the screen) is at least this. */
	supported: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { announce: 0.5, sensitive: 0.5, confident: 0.8, supported: 0.5 };

/** One action per urgency level, in level order: drop, mention, queue, interrupt. */
export type Action = (typeof URGENCY_LEVELS)[number];

export interface Decision {
	action: Action;
	/** Worth a generated detail sentence: spoken now or next (interrupt / queue) and not sensitive. */
	narratable: boolean;
	/** What would be spoken; empty when dropped. */
	speech: string;
	/** One line on why, for the decision log. */
	reason: string;
}

const PHRASES: Record<ChangeKind, string> = {
	dialog: "Dialog opened",
	error: "Error on the screen",
	notification: "New notification",
	navigation: "New page loaded",
	content: "Content updated",
	scroll: "Page scrolled",
	cosmetic: "Screen changed",
	none: "",
};

/** Urgency score (0–3, expected value) → level, rounding to the nearest. A non-number (bad model output) is 0. */
export const urgencyLevel = (score: number): Urgency =>
	(Number.isFinite(score) ? Math.max(0, Math.min(3, Math.round(score))) : 0) as Urgency;

export function decide(p: Prediction, t: Thresholds = DEFAULT_THRESHOLDS): Decision {
	const announce = p.announce ?? 0;
	if (announce < t.announce)
		return { action: "drop", narratable: false, speech: "", reason: `P(announce)=${announce.toFixed(2)} < ${t.announce}` };

	// Without an urgency answer (pixel diff), anything worth announcing is queued.
	const action = URGENCY_LEVELS[p.urgency ? urgencyLevel(p.urgency.score) : 2];
	if (action === "drop")
		return { action, narratable: false, speech: "", reason: `announce but urgency ${p.urgency?.score.toFixed(2)} → drop` };

	const kind = p.kind?.choice ?? "cosmetic";
	const kindP = p.kind?.probabilities[kind] ?? 0;
	const sensitive = (p.sensitive ?? 0) >= t.sensitive;
	let speech = PHRASES[kind] || PHRASES.cosmetic;
	if (p.kind && kindP < t.confident) speech = `Probably: ${speech.toLowerCase()}`;
	if (sensitive) speech += ". Sensitive content, not read aloud";

	return {
		action,
		narratable: (action === "interrupt" || action === "queue") && !sensitive,
		speech,
		reason: `P(announce)=${announce.toFixed(2)}, kind=${kind} (${kindP.toFixed(2)}), urgency=${p.urgency?.score.toFixed(2) ?? "n/a"}`,
	};
}
