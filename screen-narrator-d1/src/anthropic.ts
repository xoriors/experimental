// Everything the two Claude callers share — the bench's VLM baseline (backends/vlm.ts) and live mode's narrator
// (live/narrate.ts): settings from env, the request constants, pricing, reading a response, and naming an error.
// - claude-opus-5-5 always thinks: `thinking` is omitted (disabling it or a budget is a 400) and depth is set with
//   `output_config.effort` only. No temperature, no prefill: both 400 there too.
// - Server-side refusal fallbacks (`fallbacks: "default"`) re-run a declined request on Anthropic's recommended
//   fallback model inside the same call; that needs the beta endpoint and this beta header.
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const CLAUDE_MAX_TOKENS = 16000;

export interface ClaudeSettings {
	model: string;
	effort: ClaudeEffort;
}

/** NARRATOR_VLM_MODEL / NARRATOR_VLM_EFFORT, shared by `pnpm bench` and `pnpm live`. A bad effort throws in both. */
export function claudeSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): ClaudeSettings {
	const model = env.NARRATOR_VLM_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
	const effort = env.NARRATOR_VLM_EFFORT?.trim() || "low";
	if (!(CLAUDE_EFFORTS as readonly string[]).includes(effort))
		throw new Error(`NARRATOR_VLM_EFFORT must be one of ${CLAUDE_EFFORTS.join(" | ")}, got "${effort}"`);
	return { model, effort: effort as ClaudeEffort };
}

/** USD per million tokens. claude-opus-4-8 is listed because it is where `fallbacks: "default"` sends some refusals. */
const PRICES: Record<string, { input: number; output: number }> = {
	"claude-opus-5-5": { input: 4, output: 20 },
	"claude-sonnet-5-5": { input: 2, output: 10 },
	"claude-haiku-5-5": { input: 0.1, output: 0.5 },
	"claude-opus-4-8": { input: 5, output: 25 },
};

export const claudePriced = (model: string): boolean => model in PRICES;

/** Null for a model not in the table. A response served by a fallback is priced entirely at `model`'s rate. */
export function claudeCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
	const p = PRICES[model];
	return p ? (inputTokens * p.input + outputTokens * p.output) / 1e6 : null;
}

/** Claude's image billing: about width × height / 750 tokens, after downscaling to a 1568 px long edge. */
export function claudeImageTokens(width: number, height: number): number {
	const s = Math.min(1, 1568 / Math.max(width, height));
	return Math.ceil((width * s * (height * s)) / 750);
}

/** The request fields both callers send: no `thinking` (always on), no temperature, fallbacks on. */
export const claudeRequestBase = ({ model, effort }: ClaudeSettings) => ({
	model,
	max_tokens: CLAUDE_MAX_TOKENS,
	// Not `as const` on the whole object: the SDK's `betas` is a mutable array type.
	betas: [FALLBACK_BETA],
	fallbacks: "default" as const,
	output_config: { effort },
});

/** A base64 image content block. */
export const claudeImageBlock = (mediaType: "image/png" | "image/jpeg", data: string) =>
	({ type: "image", source: { type: "base64", media_type: mediaType, data } }) as const;

let client: Anthropic | undefined;
/** One lazily built client. No arguments: the SDK resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile. */
export const anthropicClient = (): Anthropic => (client ??= new Anthropic());

/** The slice of a response both callers read, so tests can fake it. */
export interface ClaudeResponse {
	model: string;
	stop_reason: string | null;
	stop_details?: { category?: string | null; explanation?: string | null } | null;
	content: ReadonlyArray<{ type: string; text?: string }>;
	usage: { input_tokens: number; output_tokens: number };
}

/** The answering model's text: after a fallback, only what follows the last fallback block is its output. */
export function responseText(res: Pick<ClaudeResponse, "content">): string {
	const lastFallback = res.content.map((b) => b.type).lastIndexOf("fallback");
	return res.content
		.slice(lastFallback + 1)
		.filter((b) => b.type === "text")
		.map((b) => b.text ?? "")
		.join("");
}

/**
 * True for failures that mean "no usable credentials": 401, 403, or the SDK finding none before sending anything.
 * DELIBERATE: any non-APIError counts, because the SDK reports "no credentials found" as a plain Error, not a typed
 * one. The cost: an unexpected non-API failure also turns the live narrator off until restart. Narrowing it would mean
 * matching the SDK's message text, which breaks silently on an SDK update. Two code reviews flagged this; revisit if
 * the SDK adds a typed missing-credentials error.
 */
export function isCredentialError(err: unknown): boolean {
	return err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || !(err instanceof Anthropic.APIError);
}

/** Typed SDK errors → one short line. The SDK has already retried 429 / 5xx / connection errors. */
export function describeClaudeError(err: unknown): Error {
	if (err instanceof Anthropic.AuthenticationError)
		return new Error("Anthropic credentials rejected (401): set ANTHROPIC_API_KEY or run `ant auth login`");
	if (err instanceof Anthropic.PermissionDeniedError) return new Error(`Anthropic permission denied (403): ${err.message}`);
	if (err instanceof Anthropic.RateLimitError) return new Error("Anthropic rate limit (429) after the SDK's retries");
	if (err instanceof Anthropic.BadRequestError) return new Error(`Anthropic bad request (400): ${err.message}`);
	if (err instanceof Anthropic.APIConnectionError) return new Error(`Anthropic connection failed: ${err.message}`);
	if (err instanceof Anthropic.APIError) return new Error(`Anthropic API error ${err.status ?? "?"}: ${err.message}`);
	return err instanceof Error ? err : new Error(String(err));
}
