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
import type { Backend, BackendOutput } from "./types.ts";
import {
	anthropicClient,
	type ClaudeEffort,
	claudeCostUsd,
	claudeImageBlock,
	claudeImageTokens,
	claudeRequestBase,
	type ClaudeResponse,
	claudeSettingsFromEnv,
	describeClaudeError,
	responseText,
} from "../anthropic.ts";
import { parseDataUrl } from "../images.ts";
import { nearestLevel } from "../policy.ts";
import { pairState, questionsFor, toPrediction } from "../questions.ts";
import type { Pair, QuestionSet } from "../types.ts";
import { zodIssues } from "../util.ts";

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
					const level = nearestLevel(j[f], top);
					return { type: "score", score: level, probabilities: { [level]: 1 } };
				},
			};
		}
	}
}

type AllFields = [string, Fields][];

const allFields = (questions: Questions): AllFields => Object.entries(questions).map(([k, q]) => [k, fieldsFor(k, q)]);

// The exported vlmSchema / vlmPrompt / vlmAnswers take a question set; vlmPlan derives the fields once and uses these.
const schemaOf = (fields: AllFields): z.ZodObject => z.object(Object.assign({}, ...fields.map(([, f]) => f.shape)));

const promptOf = (state: Record<string, string>, fields: AllFields): string =>
	[
		"The first image above is images[0], the screen before. The second image is images[1], the same screen about one second later.",
		"",
		"Situation:",
		...Object.entries(state).map(([k, v]) => `- ${k}: ${v}`),
		"",
		"Answer each question in the JSON field it names. Probabilities are numbers from 0 to 1 that say how sure you are, not just 0 or 1.",
		"",
		...fields.map(([, f]) => `- ${f.line}`),
	].join("\n");

const answersOf = (json: Json, fields: AllFields): Record<string, VlmAnswer> => Object.fromEntries(fields.map(([k, f]) => [k, f.answer(json)]));

/** The schema for one pair: every field is required, so a pair's extra questions add fields rather than optional ones. */
export const vlmSchema = (questions: Questions): z.ZodObject => schemaOf(allFields(questions));

/** The text that follows the two images: which image is which, the pair's state, and every question. */
export const vlmPrompt = (state: Record<string, string>, questions: Questions): string => promptOf(state, allFields(questions));

/** Validated JSON → one answer per question key, clamped. */
export const vlmAnswers = (json: Json, questions: Questions): Record<string, VlmAnswer> => answersOf(json, allFields(questions));

const imageBlock = (dataUrl: string) => {
	const img = parseDataUrl(dataUrl);
	if (!img) throw new Error("vlm: an image is not a base64 data URL");
	return claudeImageBlock(img.mediaType as Parameters<typeof claudeImageBlock>[0], img.data);
};

/** One pair's request, and the schema and mapper that read its answer: the question set is resolved once for all three. */
export function vlmPlan(pair: Pair, questionSet: QuestionSet, images: [string, string], model: string, effort: ClaudeEffort) {
	const fields = allFields(questionsFor(pair, questionSet));
	const schema = schemaOf(fields);
	const base = claudeRequestBase({ model, effort });
	const request = {
		...base,
		output_config: { ...base.output_config, format: betaZodOutputFormat(schema) },
		messages: [
			{
				role: "user",
				content: [imageBlock(images[0]), imageBlock(images[1]), { type: "text", text: promptOf(pairState(pair.focused), fields) }],
			},
		],
	} satisfies Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
	return { request, schema, answers: (json: Json) => answersOf(json, fields) };
}

/** The request for one pair, built separately so tests can inspect it without a client. */
export const vlmRequest = (...args: Parameters<typeof vlmPlan>) => vlmPlan(...args).request;

export type VlmRequest = ReturnType<typeof vlmRequest>;

export type VlmCall = (req: VlmRequest) => Promise<ClaudeResponse>;

const defaultCall: VlmCall = (req) => anthropicClient().beta.messages.create(req);

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
	if (!parsed.success) throw new Error(`response does not match the schema: ${zodIssues(parsed.error)}`);
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
			const plan = vlmPlan(pair, questionSet, images, model, effort);
			let res: ClaudeResponse;
			try {
				res = await call(plan.request);
			} catch (err) {
				throw describeClaudeError(err);
			}
			const json = parseVlmResponse(res, plan.schema);
			const { input_tokens, output_tokens } = res.usage;
			return {
				prediction: toPrediction(plan.answers(json)),
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
