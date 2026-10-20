// The generative-VLM baseline: a Claude model asked the same questions (rendered from questions.ts) and made to
// answer in a JSON schema, with probabilities it states itself. It tests the claim behind decision models: are
// probabilities parsed from a chat model as well calibrated, as cheap and as fast?
// - The schema, the prompt and the mapping back are all derived from the question set, one naming rule per question
//   type (see fieldsFor), so a question added to questions.ts needs no edit here.
// - `create`, not `parse`: the SDK's parse() JSON-parses every text block before we can look at stop_reason, so a
//   refusal (or a declined model's partial text ahead of a fallback block) would throw instead of being recorded.
//   We take the answering model's text and validate it with the same zod schema ourselves.
// - Structured outputs reject numeric min/max constraints, so the schema is plain and values are clamped here. The
//   SDK's schema transform also turns `enum` into a description, so an off-list label is possible and fails zod.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { ChoiceResponse, NoulResponse, Question, Questions, ScoreResponse } from "@typesafe-ai/sdk";
import { z } from "zod";
import { toPrediction } from "./liquid.ts";
import type { Backend, BackendOutput } from "./types.ts";
import {
	CLAUDE_MAX_TOKENS,
	type ClaudeEffort,
	claudeCostUsd,
	claudeImageTokens,
	type ClaudeResponse,
	claudeSettingsFromEnv,
	describeClaudeError,
	FALLBACK_BETA,
	responseText,
} from "../anthropic.ts";
import { parseDataUrl } from "../images.ts";
import { pairState, questionsFor } from "../questions.ts";
import type { Pair, QuestionSet } from "../types.ts";

/** An answer shaped like Liquid's, so toPrediction maps both backends. Scores carry no legend or confidence. */
export type VlmAnswer = NoulResponse | ChoiceResponse | Pick<ScoreResponse, "type" | "score" | "probabilities">;

type Json = Record<string, unknown>;

const instructionText = (q: Question): string => {
	const i = q.instructions;
	if (typeof i === "string") return i;
	if (i && typeof i === "object" && !Array.isArray(i))
		return Object.entries(i)
			.map(([k, v]) => (k === "question" ? String(v) : `${k}: ${JSON.stringify(v)}`))
			.join("\n  ");
	return JSON.stringify(i);
};

const describe = (d: unknown): string => (typeof d === "string" ? d : JSON.stringify(d));

/** The criteria under a question: yes / no for noul, one line per label (choice) or level (score). */
function criteria(q: Question): string {
	if (q.type === "noul") return q.criteria ? `\n  Yes means: ${describe(q.criteria.true)}\n  No means: ${describe(q.criteria.false)}` : "";
	return Object.entries(q.criteria)
		.map(([k, d]) => `\n  ${k}: ${describe(d)}`)
		.join("");
}

const PROBABILITY = "the probability (0 to 1) that the answer is yes";

const clamp01 = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5);

/** Nearest level in 0..top; a non-number is 0. For urgency (top 3) this is policy.ts's urgencyLevel. */
const clampLevel = (x: unknown, top: number): number =>
	typeof x === "number" && Number.isFinite(x) ? Math.min(top, Math.max(0, Math.round(x))) : 0;

interface Fields {
	/** JSON field → its type in the schema. */
	shape: Record<string, z.ZodType>;
	/** The prompt line naming those fields. */
	line: string;
	/** Those fields of the validated JSON → the answer. */
	answer(json: Json): VlmAnswer;
}

/** How question `key` is answered in the JSON: `<key>_probability` (noul), `<key>` + `<key>_confidence` (choice), `<key>_level` (score). */
function fieldsFor(key: string, q: Question): Fields {
	const about = `${instructionText(q)}${criteria(q)}`;
	switch (q.type) {
		case "noul": {
			const p = `${key}_probability`;
			return { shape: { [p]: z.number() }, line: `${p}: ${PROBABILITY}. ${about}`, answer: (j) => ({ type: "noul", noul: clamp01(j[p]) }) };
		}
		case "choice": {
			const conf = `${key}_confidence`;
			return {
				shape: { [key]: z.enum(Object.keys(q.criteria) as [string, ...string[]]), [conf]: z.number() },
				line: `${key}: one of the labels below, and ${conf}: the probability (0 to 1) that your ${key} is right. ${about}`,
				// The model states one confidence, so only the chosen label gets a probability.
				answer: (j) => {
					const choice = j[key] as string;
					const confidence = clamp01(j[conf]);
					return { type: "choice", choice, confidence, probabilities: { [choice]: confidence } };
				},
			};
		}
		case "score": {
			const f = `${key}_level`;
			const top = q.criteria.length - 1;
			return {
				shape: { [f]: z.int() },
				line: `${f}: one integer level from 0 to ${top}. ${about}`,
				answer: (j) => {
					const level = clampLevel(j[f], top);
					return { type: "score", score: level, probabilities: { [level]: 1 } };
				},
			};
		}
	}
}

const allFields = (questions: Questions): [string, Fields][] => Object.entries(questions).map(([k, q]) => [k, fieldsFor(k, q)]);

/** The schema for one pair: every field is required, so a pair's extra questions add fields rather than optional ones. */
export function vlmSchema(questions: Questions): z.ZodObject {
	return z.object(Object.assign({}, ...allFields(questions).map(([, f]) => f.shape)));
}

/** The text that follows the two images: which image is which, the pair's state, and every question. */
export function vlmPrompt(state: Record<string, string>, questions: Questions): string {
	return [
		"The first image above is images[0], the screen before. The second image is images[1], the same screen about one second later.",
		"",
		"Situation:",
		...Object.entries(state).map(([k, v]) => `- ${k}: ${v}`),
		"",
		"Answer each question in the JSON field it names. Probabilities are numbers from 0 to 1 that say how sure you are, not just 0 or 1.",
		"",
		...allFields(questions).map(([, f]) => `- ${f.line}`),
	].join("\n");
}

/** Validated JSON → one answer per question key, clamped. */
export function vlmAnswers(json: Json, questions: Questions): Record<string, VlmAnswer> {
	return Object.fromEntries(allFields(questions).map(([k, f]) => [k, f.answer(json)]));
}

type MediaType = Anthropic.Beta.BetaBase64ImageSource["media_type"];

const imageBlock = (dataUrl: string) => {
	const img = parseDataUrl(dataUrl);
	if (!img) throw new Error("vlm: an image is not a base64 data URL");
	return { type: "image", source: { type: "base64", media_type: img.mediaType as MediaType, data: img.data } } as const;
};

/** The request for one pair, built separately so tests can inspect it without a client. */
export function vlmRequest(pair: Pair, questionSet: QuestionSet, images: [string, string], model: string, effort: ClaudeEffort) {
	const questions = questionsFor(pair, questionSet);
	return {
		model,
		max_tokens: CLAUDE_MAX_TOKENS,
		betas: [FALLBACK_BETA],
		fallbacks: "default",
		output_config: { effort, format: betaZodOutputFormat(vlmSchema(questions)) },
		messages: [
			{
				role: "user",
				content: [imageBlock(images[0]), imageBlock(images[1]), { type: "text", text: vlmPrompt(pairState(pair.focused), questions) }],
			},
		],
	} satisfies Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
}

export type VlmRequest = ReturnType<typeof vlmRequest>;

export type VlmCall = (req: VlmRequest) => Promise<ClaudeResponse>;

let client: Anthropic | undefined;
// No arguments: the SDK resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile itself.
const defaultCall: VlmCall = (req) => (client ??= new Anthropic()).beta.messages.create(req);

/** The validated JSON in a response, or a thrown error saying why there isn't one (refusal, truncation, off-schema). */
export function parseVlmResponse(res: ClaudeResponse, schema: z.ZodType<Json>): Json {
	if (res.stop_reason === "refusal")
		throw new Error(`refusal (${res.stop_details?.category ?? "no category"}): ${res.stop_details?.explanation ?? "no explanation"}`);
	const text = responseText(res);
	if (!text.trim()) throw new Error(`no text in the response (stop_reason ${res.stop_reason})`);
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(`response is not JSON (stop_reason ${res.stop_reason}): ${text.slice(0, 120)}`);
	}
	const parsed = schema.safeParse(json);
	if (!parsed.success) throw new Error(`response does not match the schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
	return parsed.data;
}

/** Rough dry-run numbers: the prompt text, and output at low effort including thinking. */
const TEXT_TOKENS = 900;
const OUTPUT_TOKENS = 600;

export function vlmBackend(opts: { call?: VlmCall; env?: NodeJS.ProcessEnv; quiet?: boolean } = {}): Backend {
	const { model, effort } = claudeSettingsFromEnv(opts.env);
	const call = opts.call ?? defaultCall;
	if (!opts.quiet) console.error(`[vlm] model=${model} effort=${effort}`);
	return {
		name: "vlm",
		cacheable: true,
		// v2 = the prompt layout in vlmPrompt and the field names in fieldsFor; bump it when either changes (question
		// wording is keyed separately).
		fingerprint: `vlm:${model}:effort=${effort}:prompt=v2`,
		async answer({ pair, questionSet, images }): Promise<BackendOutput> {
			const questions = questionsFor(pair, questionSet);
			let res: ClaudeResponse;
			try {
				res = await call(vlmRequest(pair, questionSet, images, model, effort));
			} catch (err) {
				throw describeClaudeError(err);
			}
			const json = parseVlmResponse(res, vlmSchema(questions));
			const { input_tokens, output_tokens } = res.usage;
			return {
				prediction: toPrediction(vlmAnswers(json, questions)),
				inputTokens: input_tokens,
				outputTokens: output_tokens,
				costUsd: claudeCostUsd(res.model, input_tokens, output_tokens),
			};
		},
		estimate(pair) {
			const inputTokens = 2 * claudeImageTokens(pair.width, pair.height) + TEXT_TOKENS;
			return { inputTokens, outputTokens: OUTPUT_TOKENS, costUsd: claudeCostUsd(model, inputTokens, OUTPUT_TOKENS) };
		},
	};
}
