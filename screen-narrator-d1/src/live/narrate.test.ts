import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { CLAUDE_MAX_TOKENS, FALLBACK_BETA } from "../anthropic.ts";
import { createNarrator, NarratorUnavailableError, toNarration } from "./narrate.ts";

const usage = { input_tokens: 1500, output_tokens: 30 };
const model = "claude-opus-5-5";
const AFTER = { mediaType: "image/jpeg", data: "/9j/4AAQ" } as const;
const CONFIG = { model: "claude-opus-5-5", effort: "low" } as const;

function mockClient(create: (...args: unknown[]) => Promise<unknown>): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
	const fn = vi.fn(create);
	return { client: { beta: { messages: { create: fn } } } as unknown as Anthropic, create: fn };
}

describe("toNarration", () => {
	it("returns null on a refusal without reading content", () => {
		const n = toNarration({ model, stop_reason: "refusal", content: [{ type: "text", text: "partial" }], usage });
		expect(n).toEqual({ text: null, refused: true, model, inputTokens: 1500, outputTokens: 30 });
	});

	it("returns null when there is no text block", () => {
		const n = toNarration({ model, stop_reason: "end_turn", content: [{ type: "thinking" }], usage });
		expect(n.text).toBeNull();
		expect(n.refused).toBe(false);
	});

	it("joins text blocks, skipping others, and collapses whitespace", () => {
		const n = toNarration({
			model,
			stop_reason: "end_turn",
			content: [
				{ type: "thinking" },
				{ type: "text", text: "  Dialog: Delete 3 messages?\n" },
				{ type: "text", text: "Buttons Cancel and Delete " },
			],
			usage,
		});
		expect(n.text).toBe("Dialog: Delete 3 messages? Buttons Cancel and Delete");
	});

	it("after a server-side fallback, keeps only the fallback model's text and names that model", () => {
		const n = toNarration({
			model: "claude-opus-4-8",
			stop_reason: "end_turn",
			content: [
				{ type: "text", text: "The declined model's partial answer" },
				{ type: "fallback" },
				{ type: "text", text: "Dialog: Delete 3 messages?" },
			],
			usage,
		});
		expect(n).toMatchObject({ text: "Dialog: Delete 3 messages?", refused: false, model: "claude-opus-4-8" });
	});

	it("caps very long answers", () => {
		const n = toNarration({ model, stop_reason: "end_turn", content: [{ type: "text", text: "x".repeat(1000) }], usage });
		expect(n.text).toHaveLength(300);
	});
});

describe("createNarrator", () => {
	it("sends the frame with effort, fallbacks and no thinking or temperature", async () => {
		const { client, create } = mockClient(async () => ({ model, stop_reason: "end_turn", content: [{ type: "text", text: "New message from Ana" }], usage }));
		const n = createNarrator({ config: CONFIG, client, available: true });
		const out = await n.narrate(AFTER, { speech: "New notification" });
		expect(out).toMatchObject({ text: "New message from Ana", model });

		const params = create.mock.calls[0]![0] as Record<string, unknown>;
		expect(params).toMatchObject({
			model: "claude-opus-5-5",
			max_tokens: CLAUDE_MAX_TOKENS,
			betas: [FALLBACK_BETA],
			fallbacks: "default",
			output_config: { effort: "low" },
		});
		expect(params).not.toHaveProperty("thinking");
		expect(params).not.toHaveProperty("temperature");
		const messages = params.messages as { role: string; content: { type: string; source?: unknown; text?: string }[] }[];
		expect(messages).toHaveLength(1);
		expect(messages[0]!.role).toBe("user");
		expect(messages[0]!.content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/4AAQ" } });
		expect(messages[0]!.content[1]!.text).toContain("New notification");
	});

	it("marks itself unavailable on an authentication error", async () => {
		const authError = new Anthropic.AuthenticationError(401, { type: "error" }, "invalid x-api-key", new Headers());
		const { client } = mockClient(async () => {
			throw authError;
		});
		const n = createNarrator({ config: CONFIG, client, available: true });
		await expect(n.narrate(AFTER, { speech: "" })).rejects.toBeInstanceOf(NarratorUnavailableError);
		expect(n.available).toBe(false);
	});

	it("marks itself unavailable when the SDK finds no credentials", async () => {
		const { client } = mockClient(async () => {
			throw new Error("Could not resolve authentication method.");
		});
		const n = createNarrator({ config: CONFIG, client, available: true });
		await expect(n.narrate(AFTER, { speech: "" })).rejects.toBeInstanceOf(NarratorUnavailableError);
		expect(n.available).toBe(false);
	});

	it("rethrows other API errors and stays available", async () => {
		const { client } = mockClient(async () => {
			throw new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers());
		});
		const n = createNarrator({ config: CONFIG, client, available: true });
		await expect(n.narrate(AFTER, { speech: "" })).rejects.toBeInstanceOf(Anthropic.RateLimitError);
		expect(n.available).toBe(true);
	});

	it("refuses to call when unavailable", async () => {
		const { client, create } = mockClient(async () => ({}));
		const n = createNarrator({ config: CONFIG, client, available: false });
		await expect(n.narrate(AFTER, { speech: "" })).rejects.toBeInstanceOf(NarratorUnavailableError);
		expect(create).not.toHaveBeenCalled();
	});
});
