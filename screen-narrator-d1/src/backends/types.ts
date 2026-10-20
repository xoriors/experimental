import type { Pair, Prediction, QuestionSet } from "../types.ts";

export interface BackendInput {
	pair: Pair;
	questionSet: QuestionSet;
	/** The pair's screenshots as `data:image/png;base64,…` URLs, in order: before, after. */
	images: [string, string];
}

export interface BackendOutput {
	prediction: Prediction;
	inputTokens?: number;
	outputTokens?: number;
	/** Null when the model's price is unknown. */
	costUsd?: number | null;
}

/** A dry-run guess at what answering one pair would use and cost, without calling anything. */
export interface BackendEstimate {
	inputTokens: number;
	outputTokens: number;
	/** Null when the model's price is unknown. */
	costUsd: number | null;
}

/** One way of answering the question set for a pair: a Liquid model, the pixel-diff baseline, a generative VLM. */
export interface Backend {
	/** Shown in reports and used on the CLI, e.g. `d1-ultra`, `pixel-diff`, `vlm`. */
	name: string;
	/** Paid API calls are cached in runs/cache; free local ones are not. */
	cacheable: boolean;
	/** Changes whenever the backend's settings change (model id, effort, threshold), so the cache never serves stale answers. */
	fingerprint: string;
	answer(input: BackendInput): Promise<BackendOutput>;
	/** For `pnpm bench --dry-run`; a backend without one is listed as "no estimate". */
	estimate?(pair: Pair, questionSet: QuestionSet): BackendEstimate;
}
