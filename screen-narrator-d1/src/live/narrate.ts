// The optional generative step of live mode: Claude looks at the AFTER frame and writes one sentence of detail
// ("Dialog: Delete 3 messages? Buttons Cancel and Delete"). The server fact-checks it with Liquid before the page
// may speak it, so a hallucinated detail is caught rather than read out.
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MAX_TOKENS, type ClaudeResponse, type ClaudeSettings, FALLBACK_BETA, isCredentialError, responseText } from "../anthropic.ts";
import type { Decision } from "../policy.ts";

/**
 * A guess, without any network call, at whether `new Anthropic()` will find credentials: an env var, or an
 * `ant auth login` profile directory (only its existence is checked; nothing in it is read). A wrong guess is
 * corrected by the first call, which marks the narrator unavailable on an authentication failure.
 */
export function credentialsLikelyPresent(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim() || env.ANTHROPIC_PROFILE?.trim()) return true;
	const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
	return existsSync(path.join(configHome, "anthropic"));
}

export interface FrameImage {
	mediaType: "image/jpeg" | "image/png";
	/** Base64, without the `data:` prefix. */
	data: string;
}

export interface Narration {
	/** Null when Claude refused or answered without text. */
	text: string | null;
	refused: boolean;
	/** The model that answered: `config.model`, or the fallback model when the API re-ran a declined request. */
	model: string;
	inputTokens: number;
	outputTokens: number;
}

export class NarratorUnavailableError extends Error {}

export interface Narrator {
	readonly available: boolean;
	readonly config: ClaudeSettings;
	narrate(after: FrameImage, decision: Pick<Decision, "speech">): Promise<Narration>;
}

const SYSTEM = [
	"You help a screen narrator for blind and low-vision users.",
	"You see the screen right after something on it changed.",
	"Say in one short sentence of plain language what the user needs to know about the main change, as a screen reader would announce it.",
	'Name the kind of thing first, then the essentials, for example: "Dialog: Delete 3 messages? Buttons Cancel and Delete".',
	"Never read out passwords, card or bank numbers, or the text of private messages; say that one is there instead.",
	"Reply with the sentence only.",
].join(" ");

/** Longer than any useful one-sentence announcement; anything past it is not something to speak. */
const MAX_CHARS = 300;

export function createNarrator(opts: { config: ClaudeSettings; client?: Anthropic; available?: boolean }): Narrator {
	const { config } = opts;
	let available = opts.available ?? credentialsLikelyPresent();
	let client = opts.client;

	return {
		config,
		get available() {
			return available;
		},
		async narrate(after, decision) {
			if (!available) throw new NarratorUnavailableError("no Claude credentials");
			client ??= new Anthropic();
			let res: Anthropic.Beta.BetaMessage;
			try {
				// No `thinking`, temperature or prefill, and a server-side fallback: see anthropic.ts.
				res = await client.beta.messages.create(
					{
						model: config.model,
						max_tokens: CLAUDE_MAX_TOKENS,
						betas: [FALLBACK_BETA],
						fallbacks: "default",
						output_config: { effort: config.effort },
						system: SYSTEM,
						messages: [
							{
								role: "user",
								content: [
									{ type: "image", source: { type: "base64", media_type: after.mediaType, data: after.data } },
									{ type: "text", text: `The narrator's template announcement was: "${decision.speech || "Screen changed"}". Describe the main change.` },
								],
							},
						],
					},
					{ timeout: 60_000 },
				);
			} catch (err) {
				if (isCredentialError(err)) {
					available = false;
					throw new NarratorUnavailableError(err instanceof Error ? err.message : String(err));
				}
				throw err;
			}
			return toNarration(res);
		},
	};
}

/** Exported for tests: what to make of one response. */
export function toNarration(res: Pick<ClaudeResponse, "model" | "stop_reason" | "content" | "usage">): Narration {
	const meta = { model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
	if (res.stop_reason === "refusal") return { text: null, refused: true, ...meta };
	// Only the answering model's text: after a fallback, a declined model's partial output must not be spoken.
	const text = responseText(res).replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
	return { text: text || null, refused: false, ...meta };
}
