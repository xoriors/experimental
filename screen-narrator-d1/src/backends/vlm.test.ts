import Anthropic from "@anthropic-ai/sdk";
import { choice, noul, type Questions, score } from "@typesafe-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { parseVlmResponse, vlmAnswers, vlmBackend, type VlmCall, vlmPlan, vlmPrompt, vlmRequest, vlmSchema } from "./vlm.ts";
import type { ClaudeResponse } from "../anthropic.ts";
import { CORE_QUESTIONS, pairState, questionsFor } from "../questions.ts";

// questionsFor spied on (still the real one), to check a pair's question set is resolved once per answer.
vi.mock("../questions.ts", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../questions.ts")>();
	return { ...orig, questionsFor: vi.fn(orig.questionsFor) };
});
import type { Pair } from "../types.ts";

const IMAGES: [string, string] = ["data:image/png;base64,QkVGT1JF", "data:image/jpeg;base64,QUZURVI="];

const pair = (labels: Partial<Pair["labels"]> = {}): Pair =>
	({ id: "p", width: 1280, height: 800, labels: { announce: true, kind: "dialog", urgency: 3, sensitive: false, ...labels } }) as Pair;

const labelled = pair({
	primary: { candidates: { e0: "button 'Delete'", e1: "button 'Cancel'" }, answer: "e0" },
	narrations: { supported: "A dialog asks to delete 3 files", unsupported: "A dialog asks to delete 5 files" },
});

const answer = { announce_probability: 0.9, kind: "dialog", kind_confidence: 0.8, urgency_level: 3, sensitive_probability: 0.1 };

const response = (over: Partial<ClaudeResponse> = {}, body: unknown = answer): ClaudeResponse => ({
	model: "claude-opus-5-5",
	stop_reason: "end_turn",
	content: [{ type: "text", text: JSON.stringify(body) }],
	usage: { input_tokens: 3000, output_tokens: 500 },
	...over,
});

const shapeKeys = (questions: Questions) => Object.keys(vlmSchema(questions).shape);

describe("vlmPlan", () => {
	it("validates and maps with the same schema the request sends", () => {
		const plan = vlmPlan(labelled, "all", IMAGES, "claude-opus-5-5", "low");
		expect(Object.keys(plan.schema.shape)).toEqual(shapeKeys(questionsFor(labelled, "all")));
		expect(plan.request.output_config.format.schema).toEqual(vlmRequest(labelled, "all", IMAGES, "claude-opus-5-5", "low").output_config.format.schema);
		const full = { ...answer, primary: "e0", primary_confidence: 0.7, supportedTrue_probability: 0.95, supportedFalse_probability: 0.2 };
		expect(plan.answers(parseVlmResponse(response({}, full), plan.schema))).toEqual(vlmAnswers(full, questionsFor(labelled, "all")));
	});
});

describe("vlmRequest", () => {
	it("sends before, after, then the questions; effort and fallbacks, never thinking or temperature", () => {
		const req = vlmRequest(labelled, "all", IMAGES, "claude-opus-5-5", "low");
		expect(req).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
		expect(req.output_config.effort).toBe("low");
		expect(req.output_config.format.type).toBe("json_schema");
		expect(req).not.toHaveProperty("thinking");
		expect(req).not.toHaveProperty("temperature");
		const [before, after, text] = req.messages[0]!.content;
		// The media type comes from the data URL, not a hardcoded PNG.
		expect(before).toMatchObject({ type: "image", source: { media_type: "image/png", data: "QkVGT1JF" } });
		expect(after).toMatchObject({ type: "image", source: { media_type: "image/jpeg", data: "QUZURVI=" } });
		expect(text?.type).toBe("text");
		const prompt = (text as { text: string }).text;
		// The wording comes from questions.ts, so every backend is asked the same thing.
		expect(prompt).toContain("What is the main change between images[0] and images[1]?");
		expect(prompt).toContain("A dialog asks to delete 5 files");
		expect(prompt).toContain("e1: button 'Cancel'");
		expect(prompt).toContain("urgency_level: one integer level from 0 to 3.");
	});

	it("refuses an image that isn't a data URL", () => {
		expect(() => vlmRequest(pair(), "core", ["before.png", IMAGES[1]], "claude-opus-5-5", "low")).toThrow(/data URL/);
	});
});

describe("vlmSchema", () => {
	it("names fields by question type", () => {
		expect(shapeKeys(CORE_QUESTIONS)).toEqual(["announce_probability", "kind", "kind_confidence", "urgency_level", "sensitive_probability"]);
	});

	it("only adds primary and supported fields when the pair has those labels and the set is all", () => {
		expect(shapeKeys(questionsFor(labelled, "all"))).toEqual(
			expect.arrayContaining(["primary", "primary_confidence", "supportedTrue_probability", "supportedFalse_probability"]),
		);
		expect(shapeKeys(questionsFor(labelled, "core"))).not.toContain("primary");
		expect(shapeKeys(questionsFor(pair(), "all"))).not.toContain("supportedTrue_probability");
	});
});

describe("a question added to questions.ts", () => {
	// Made up, one per type: none of these keys appears in vlm.ts.
	const extra: Questions = {
		...CORE_QUESTIONS,
		blocking: noul("Does images[1] block the rest of the page?", { true: "It does", false: "It doesn't" }),
		tone: choice("What tone does images[1] have?", { calm: "Calm", alarming: "Alarming" }),
		clutter: score("How cluttered is images[1]?", ["Clean", "Busy", "Chaotic"]),
	};

	it("gets fields, a prompt line and a mapped answer with no edit to vlm.ts", () => {
		expect(shapeKeys(extra)).toEqual(expect.arrayContaining(["blocking_probability", "tone", "tone_confidence", "clutter_level"]));
		const prompt = vlmPrompt(pairState(), extra);
		expect(prompt).toContain("- blocking_probability: the probability (0 to 1) that the answer is yes. Does images[1] block the rest of the page?\n  Yes means: It does");
		expect(prompt).toContain("- tone: one of the labels below, and tone_confidence: ");
		expect(prompt).toContain("\n  alarming: Alarming");
		expect(prompt).toContain("- clutter_level: one integer level from 0 to 2. How cluttered is images[1]?\n  0: Clean\n  1: Busy\n  2: Chaotic");
		const json = vlmSchema(extra).parse({ ...answer, blocking_probability: 0.7, tone: "alarming", tone_confidence: 0.6, clutter_level: 9 });
		const a = vlmAnswers(json, extra);
		expect(a.blocking).toEqual({ type: "noul", noul: 0.7 });
		expect(a.tone).toEqual({ type: "choice", choice: "alarming", confidence: 0.6, probabilities: { alarming: 0.6 } });
		// Clamped to the question's own top level (2), not urgency's 3.
		expect(a.clutter).toEqual({ type: "score", score: 2, probabilities: { "2": 1 } });
	});
});

describe("vlmAnswers", () => {
	it("maps fields onto Liquid-shaped answers", () => {
		const q = questionsFor(labelled, "all");
		const a = vlmAnswers(
			{ ...answer, primary: "e0", primary_confidence: 0.7, supportedTrue_probability: 0.95, supportedFalse_probability: 0.2 },
			q,
		);
		expect(a).toEqual({
			announce: { type: "noul", noul: 0.9 },
			kind: { type: "choice", choice: "dialog", confidence: 0.8, probabilities: { dialog: 0.8 } },
			urgency: { type: "score", score: 3, probabilities: { "3": 1 } },
			sensitive: { type: "noul", noul: 0.1 },
			primary: { type: "choice", choice: "e0", confidence: 0.7, probabilities: { e0: 0.7 } },
			supportedTrue: { type: "noul", noul: 0.95 },
			supportedFalse: { type: "noul", noul: 0.2 },
		});
	});

	it("clamps out-of-range numbers and levels", () => {
		const a = vlmAnswers({ ...answer, announce_probability: 1.4, kind_confidence: -0.2, urgency_level: 7, sensitive_probability: Number.NaN }, CORE_QUESTIONS);
		expect(a.announce).toEqual({ type: "noul", noul: 1 });
		expect(a.kind).toMatchObject({ confidence: 0, probabilities: { dialog: 0 } });
		expect(a.urgency).toEqual({ type: "score", score: 3, probabilities: { "3": 1 } });
		expect(a.sensitive).toEqual({ type: "noul", noul: 0.5 });
		expect(vlmAnswers({ ...answer, urgency_level: -2 }, CORE_QUESTIONS).urgency).toMatchObject({ score: 0 });
	});
});

describe("parseVlmResponse", () => {
	const schema = vlmSchema(questionsFor(pair(), "core"));

	it("records a refusal instead of reading content", () => {
		const refused = response({ stop_reason: "refusal", stop_details: { category: "cyber", explanation: "declined" }, content: [{ type: "text", text: "I can't" }] });
		expect(() => parseVlmResponse(refused, schema)).toThrow("refusal (cyber): declined");
	});

	it("reads only the answer after the last fallback block", () => {
		const res = response({
			content: [{ type: "text", text: '{"announce_probability": 0.1, "kin' }, { type: "fallback" }, { type: "text", text: JSON.stringify(answer) }],
		});
		expect(parseVlmResponse(res, schema)).toEqual(answer);
	});

	it("rejects truncated, empty and off-schema answers", () => {
		expect(() => parseVlmResponse(response({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"announce' }] }), schema)).toThrow(/not JSON \(stop_reason max_tokens\)/);
		expect(() => parseVlmResponse(response({ content: [] }), schema)).toThrow(/no text/);
		expect(() => parseVlmResponse(response({}, { ...answer, kind: "popup" }), schema)).toThrow(/schema/);
		// Levels are integers in the schema, so a fractional one is off-schema rather than rounded.
		expect(() => parseVlmResponse(response({}, { ...answer, urgency_level: 2.5 }), schema)).toThrow(/schema/);
	});
});

describe("vlmBackend", () => {
	it("answers through the injected call and prices the tokens", async () => {
		const calls: unknown[] = [];
		const call: VlmCall = async (req) => {
			calls.push(req);
			return response();
		};
		const b = vlmBackend({ call, env: { NARRATOR_VLM_EFFORT: "medium" }, quiet: true });
		expect(b.fingerprint).toBe("vlm:claude-opus-5-5:effort=medium:prompt=v2");
		vi.mocked(questionsFor).mockClear();
		const out = await b.answer({ pair: pair(), questionSet: "all", images: IMAGES });
		expect(calls).toHaveLength(1);
		// One question set per pair: the request's schema is the one that validates the answer.
		expect(questionsFor).toHaveBeenCalledTimes(1);
		expect(out.prediction).toEqual({
			announce: 0.9,
			kind: { choice: "dialog", probabilities: { dialog: 0.8 } },
			urgency: { score: 3, probabilities: { "3": 1 } },
			sensitive: 0.1,
		});
		expect(out).toMatchObject({ inputTokens: 3000, outputTokens: 500 });
		expect(out.costUsd).toBeCloseTo((3000 * 4 + 500 * 20) / 1e6, 10);
	});

	it("takes the model and effort from env and rejects an unknown effort", () => {
		expect(vlmBackend({ env: { NARRATOR_VLM_MODEL: "claude-haiku-5-5", NARRATOR_VLM_EFFORT: "xhigh" }, quiet: true }).fingerprint).toBe(
			"vlm:claude-haiku-5-5:effort=xhigh:prompt=v2",
		);
		expect(() => vlmBackend({ env: { NARRATOR_VLM_EFFORT: "turbo" }, quiet: true })).toThrow(/NARRATOR_VLM_EFFORT/);
	});

	it("throws on a refusal and turns SDK errors into short messages", async () => {
		const refusing = vlmBackend({ call: async () => response({ stop_reason: "refusal", stop_details: null }), env: {}, quiet: true });
		await expect(refusing.answer({ pair: pair(), questionSet: "core", images: IMAGES })).rejects.toThrow(/refusal/);
		const limited = vlmBackend({
			call: async () => {
				throw new Anthropic.RateLimitError(429, undefined, "slow down", new Headers());
			},
			env: {},
			quiet: true,
		});
		await expect(limited.answer({ pair: pair(), questionSet: "core", images: IMAGES })).rejects.toThrow(/rate limit \(429\)/);
	});

	it("estimates a pair from Claude's image billing and the model's price", () => {
		const e = vlmBackend({ env: {}, quiet: true }).estimate!(pair(), "all");
		// 1280×800 is under the 1568 px long edge: 1366 tokens per image, plus 900 of text.
		expect(e).toEqual({ inputTokens: 2 * 1366 + 900, outputTokens: 600, costUsd: ((2 * 1366 + 900) * 4 + 600 * 20) / 1e6 });
	});
});
