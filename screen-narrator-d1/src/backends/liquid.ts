// Liquid AI's hosted decision models (d1-ultra, d1) through the TypeSafe SDK — Liquid's decision API is the same
// System One API (`POST …/v1/systemone`, the same noul / choice / score shapes) under a different base URL.
// - SDK pinned to 0.6.0: 0.7 compresses bodies with zstd by default, which Liquid's API rejects (an upgrade needs
//   `compression: false`), and its docs drop the /decisions path from the base URL — re-check both before upgrading.
// - `images` is not in 0.6's request type, but the SDK forwards unknown request properties as-is.
// - The API key is passed explicitly: without it the SDK falls back to TYPESAFE_API_KEY and would send that key here.
import { type Questions, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Backend, BackendEstimate, BackendOutput } from "./types.ts";
import { pairState, questionsFor, toPrediction } from "../questions.ts";
import type { Pair, QuestionSet } from "../types.ts";

export const LIQUID_BASE_URL = "https://api.liquid.ai/decisions";
export const LIQUID_MODELS = ["d1-ultra", "d1"] as const;
export type LiquidModel = (typeof LIQUID_MODELS)[number];

/** USD per million input tokens (output is free). d1's price isn't hardcoded: set LIQUID_D1_USD_PER_MTOK to get costs. */
export function liquidPricePerMTok(model: LiquidModel): number | null {
	if (model === "d1-ultra") return 0.042;
	const raw = process.env.LIQUID_D1_USD_PER_MTOK?.trim();
	if (!raw) return null;
	const price = Number(raw);
	if (!Number.isFinite(price) || price < 0) throw new Error(`LIQUID_D1_USD_PER_MTOK must be a non-negative number, got "${raw}"`);
	return price;
}

/** Null when the model's price is unknown. */
export function liquidCostUsd(model: LiquidModel, inputTokens: number): number | null {
	const price = liquidPricePerMTok(model);
	return price === null ? null : (inputTokens / 1e6) * price;
}

let client: TypeSafeClient | undefined;
function liquidClient(): TypeSafeClient {
	const apiKey = process.env.LIQUID_API_KEY?.trim();
	if (!apiKey) throw new Error("LIQUID_API_KEY is not set (put it in screen-narrator-d1/.env, see .env.example)");
	client ??= new TypeSafeClient({ apiKey, baseURL: LIQUID_BASE_URL, defaultModel: "d1-ultra", timeout: 30_000, logLevel: "warn" });
	return client;
}

export interface LiquidRequest {
	model: LiquidModel;
	state: Record<string, string>;
	questions: Questions;
	/** data URLs, in the order `state` refers to them. */
	images: string[];
}

export interface LiquidResponse {
	answers: Record<string, unknown>;
	inputTokens: number;
}

/** One raw call. Used by the bench backend below and by live mode. */
export async function askLiquid(req: LiquidRequest): Promise<LiquidResponse> {
	const res = await liquidClient().systemOne({ model: req.model, state: req.state, questions: req.questions, images: req.images } as never);
	const missing = Object.keys(req.questions).filter((k) => !(k in res.answers));
	if (missing.length) throw new Error(`Liquid answered without ${missing.join(", ")}`);
	return { answers: res.answers as Record<string, unknown>, inputTokens: res.usage.input_tokens };
}

/**
 * Liquid's image tokens: 1.5 per 32×32 patch, rounded up per image. The docs say images are charged again for every
 * question, but measured `usage.input_tokens` counts them once per request (see liquidEstimate).
 */
export const liquidImageTokens = (width: number, height: number): number =>
	Math.ceil(Math.ceil(width / 32) * Math.ceil(height / 32) * 1.5);

/** Text tokens per question (state + question wording); fitted to the first full run's usage. */
const TEXT_TOKENS_PER_QUESTION = 110;

/** The dry-run estimate for one pair. */
export function liquidEstimate(model: LiquidModel, pair: Pair, questionSet: QuestionSet): BackendEstimate {
	// DELIBERATE: images counted once per request, not once per question as Liquid's docs say. The first full run
	// (2026-10-19, 142 pairs × ~4.7 questions) reported 2,877 input tokens per pair in `usage.input_tokens`,
	// about the two images once; the per-question formula over-estimated it ~4×. Re-check if billing changes.
	const questions = Object.keys(questionsFor(pair, questionSet)).length;
	const inputTokens = 2 * liquidImageTokens(pair.width, pair.height) + questions * TEXT_TOKENS_PER_QUESTION;
	return { inputTokens, outputTokens: 0, costUsd: liquidCostUsd(model, inputTokens) };
}

export function liquidBackend(model: LiquidModel): Backend {
	return {
		name: model,
		cacheable: true,
		fingerprint: `liquid:${model}`,
		async answer({ pair, questionSet, images }): Promise<BackendOutput> {
			const res = await askLiquid({ model, state: pairState(pair.focused), questions: questionsFor(pair, questionSet), images });
			return {
				prediction: toPrediction(res.answers),
				inputTokens: res.inputTokens,
				outputTokens: 0,
				costUsd: liquidCostUsd(model, res.inputTokens),
			};
		},
		estimate: (pair, questionSet) => liquidEstimate(model, pair, questionSet),
	};
}
