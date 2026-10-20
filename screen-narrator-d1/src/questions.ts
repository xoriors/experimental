// The question set, in one place: every backend asks these (the Liquid backends verbatim, the VLM baseline via
// their wording), and the benchmark exists to tune them. Change wording here and re-run; the cache key includes it.
import { type ChoiceResponse, choice, type NoulResponse, noul, type Questions, type ResultFor, score } from "@typesafe-ai/sdk";
import type { ChangeKind, Pair, Prediction, QuestionSet } from "./types.ts";

/** `state` for a before/after pair. The docs say image order matters, so it names images by position. */
export function pairState(focused?: string): Record<string, string> {
	return {
		images: "images[0] is the screen before, images[1] is the same screen about one second later",
		user: "The user is blind and uses a screen reader; they only know what is announced to them",
		...(focused ? { focused: `Keyboard focus is on: ${focused}` } : {}),
	};
}

export const ANNOUNCE = noul(
	"Did something change between images[0] and images[1] that a blind user needs to be told about to keep using the app — a dialog, an error, a notification or message, new or loaded content, or a change to the control they are on?",
	{
		true: "Something appeared, disappeared or changed that affects what the user can read or do",
		false: "Nothing changed, or only cosmetic things changed: a hover highlight, an animation or spinner frame, a clock ticking, the page scrolling",
	},
);

export const KIND = choice("What is the main change between images[0] and images[1]?", {
	dialog: "A modal dialog, popup, cookie banner or permission prompt appeared or closed",
	error: "An error or warning message appeared",
	notification: "A toast, banner, badge or new incoming message appeared",
	navigation: "A different page or screen loaded",
	content: "Content within the same page was added, removed or updated",
	scroll: "The same content moved because the page scrolled",
	cosmetic: "Only visual styling changed: hover, focus ring, animation or spinner frame, colours",
	none: "No visible change",
} satisfies Record<ChangeKind, string>);

export const URGENCY = score("How urgently should a blind user be told about the change between images[0] and images[1]?", [
	"Not at all: drop it",
	"Only when they ask what is new",
	"After the screen reader finishes what it is currently saying",
	"Interrupt immediately: it blocks them or needs their action now",
]);

export const SENSITIVE = noul(
	"Does images[1] show sensitive information: a password, card or bank details or balances, private messages, health records or identity documents?",
);

/** `primary`: which accessibility-tree candidate is the main action on the AFTER screen. */
export const primaryQuestion = (candidates: Record<string, string>) =>
	choice("Which of these elements of images[1] is the main action the user is expected to take next?", candidates);

/** `supported`: is a narration fact-checked by the AFTER screen. The narration goes in the instructions. */
export const supportedQuestion = (narration: string) =>
	noul({ question: "Is every claim in `narration` visibly supported by images[1]?", narration }, {
		true: "Everything it says can be seen in images[1]",
		false: "It states at least one thing that images[1] does not show, or contradicts it",
	});

/** The `core` set: what every pair is asked, and what live mode asks per frame pair (sensitive lets it refuse to narrate). */
export const CORE_QUESTIONS = { announce: ANNOUNCE, kind: KIND, urgency: URGENCY, sensitive: SENSITIVE } satisfies Questions;

/** The questions to ask for one pair. `all` adds primary / supported only where the pair is labelled for them. */
export function questionsFor(pair: Pair, set: QuestionSet): Questions {
	const q: Questions = { ...CORE_QUESTIONS };
	if (set === "all") {
		if (pair.labels.primary) q.primary = primaryQuestion(pair.labels.primary.candidates);
		if (pair.labels.narrations) {
			q.supportedTrue = supportedQuestion(pair.labels.narrations.supported);
			q.supportedFalse = supportedQuestion(pair.labels.narrations.unsupported);
		}
	}
	return q;
}

/** Answers keyed as above; the core ones typed by their question, so kind / urgency keep their label types. */
type Answers = Partial<
	{ [K in keyof typeof CORE_QUESTIONS]: ResultFor<(typeof CORE_QUESTIONS)[K]> } & {
		primary: ChoiceResponse;
		supportedTrue: NoulResponse;
		supportedFalse: NoulResponse;
	}
>;

/** The yes-probability of a noul answer under `key`, or undefined when it is missing or malformed. */
export function noulOf(answers: Record<string, unknown>, key: string): number | undefined {
	const p = (answers[key] as { noul?: unknown } | undefined)?.noul;
	return typeof p === "number" && Number.isFinite(p) ? p : undefined;
}

/**
 * Answers keyed as in this file → a Prediction. The one decoder of these keys: the Liquid backends and the VLM (which
 * returns Liquid-shaped answers) both go through it. Unknown keys are ignored; absent ones stay absent.
 */
export function toPrediction(answers: Record<string, unknown>): Prediction {
	const a = answers as Answers;
	const p: Prediction = {};
	// A malformed noul (null, a string) stays absent, so metrics skip it instead of scoring it as a confident "no".
	const announce = noulOf(answers, "announce"), sensitive = noulOf(answers, "sensitive");
	if (announce !== undefined) p.announce = announce;
	if (a.kind) p.kind = { choice: a.kind.choice, probabilities: a.kind.probabilities };
	if (a.urgency) p.urgency = { score: a.urgency.score, probabilities: a.urgency.probabilities };
	if (sensitive !== undefined) p.sensitive = sensitive;
	if (a.primary) p.primary = { choice: a.primary.choice, probabilities: a.primary.probabilities };
	const supported = noulOf(answers, "supportedTrue"), unsupported = noulOf(answers, "supportedFalse");
	if (supported !== undefined && unsupported !== undefined) p.supported = { supported, unsupported };
	return p;
}
