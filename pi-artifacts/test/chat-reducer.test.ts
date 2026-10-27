import { describe, expect, it } from "vitest";
import { reduce, type ChatState } from "../src/chat/useChat.ts";

const empty: ChatState = { entries: [], tools: [], busy: false };
const assistant = (content: unknown[]) => ({ role: "assistant", content, api: "anthropic-messages", provider: "cloudflare", model: "m", usage: {}, stopReason: "stop", timestamp: 0 });

// Event shapes as the deployed agent streams them: an assistant message can
// open with blocks already in it, and later changes index past them.
describe("chat reducer", () => {
  it("keeps the blocks an assistant message opens with", () => {
    const state = reduce(empty, {
      type: "events",
      events: [
        { type: "message_start", message: assistant([{ type: "text", text: "I can build live" }]) },
        { type: "message_update", usage: {}, changes: [{ type: "text_delta", contentIndex: 0, delta: " dashboards." }] },
      ] as never,
    });
    expect(state.partial?.content).toEqual([{ type: "text", text: "I can build live dashboards." }]);
  });

  it("leaves no holes when a later block starts after the opening ones", () => {
    const state = reduce(empty, {
      type: "events",
      events: [
        { type: "message_start", message: assistant([{ type: "thinking", thinking: "Plan" }]) },
        { type: "message_update", usage: {}, changes: [{ type: "text_start", contentIndex: 1, block: { type: "text", text: "Done" } }] },
      ] as never,
    });
    const content = state.partial!.content;
    expect(content).toHaveLength(2);
    expect(content.every((block) => block !== undefined)).toBe(true);
  });

  it("ignores message_start for user, system and tool-result messages", () => {
    const state = reduce(empty, {
      type: "events",
      events: [
        { type: "message_start", message: { role: "user", content: "hi", timestamp: 0 } },
        { type: "message_start", message: { role: "system", content: "" } },
      ] as never,
    });
    expect(state.partial).toBeUndefined();
  });
});
