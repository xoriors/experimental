import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentEvent, EntryRecord } from "@earendil-works/pi-durable";
import { useEffect, useReducer, useRef, useState } from "react";
import type { ChatClientMessage, ChatServerMessage } from "../../shared/protocol.ts";
import { api } from "../api.ts";

export interface RunningTool {
  toolCallId: string;
  toolName: string;
  args: unknown;
  output: string;
}

export interface ChatState {
  entries: EntryRecord[];
  /** The assistant message being generated, if any. */
  partial?: AssistantMessage;
  tools: RunningTool[];
  busy: boolean;
  error?: string;
}

const initial: ChatState = { entries: [], tools: [], busy: false };

type Action = { type: "events"; events: AgentEvent[] } | { type: "error"; message?: string } | { type: "reset" };

function addEntry(entries: EntryRecord[], entry: EntryRecord): EntryRecord[] {
  return entries.some((e) => e.id === entry.id) ? entries : [...entries, entry];
}

/** Apply pi-durable's agent events to the view: a snapshot replaces everything, the rest are deltas on top of it. */
export function reduce(state: ChatState, action: Action): ChatState {
  if (action.type === "reset") return initial;
  if (action.type === "error") return { ...state, error: action.message };
  let next = state;
  for (const event of action.events) {
    switch (event.type) {
      case "snapshot":
        next = { entries: [...event.entries], partial: event.generation?.message, tools: [], busy: event.run !== undefined };
        break;
      case "run_start":
        next = { ...next, busy: true, error: undefined };
        break;
      case "run_end":
        next = { ...next, busy: false, partial: undefined, tools: [] };
        break;
      case "message_start":
        // An assistant message can open with blocks already in it; later changes index into them.
        if (event.message.role === "assistant") next = { ...next, partial: { ...event.message, content: [...event.message.content] } };
        break;
      case "message_update": {
        if (!next.partial) break;
        const content = [...next.partial.content];
        for (const change of event.changes) {
          if (change.type === "message") {
            content.splice(0, content.length, ...change.message.content);
          } else if (change.type === "text_start" || change.type === "thinking_start" || change.type === "toolcall_start" || change.type === "block") {
            content[change.contentIndex] = change.block;
          } else if (change.type === "text_delta") {
            const block = content[change.contentIndex];
            if (block?.type === "text") content[change.contentIndex] = { ...block, text: block.text + change.delta };
          } else if (change.type === "thinking_delta") {
            const block = content[change.contentIndex];
            if (block?.type === "thinking") content[change.contentIndex] = { ...block, thinking: block.thinking + change.delta };
          }
        }
        next = { ...next, partial: { ...next.partial, content } };
        break;
      }
      case "message_end":
        next = { ...next, entries: addEntry(next.entries, event.entry), partial: undefined };
        break;
      case "entry_appended":
        next = { ...next, entries: addEntry(next.entries, event.entry) };
        break;
      case "tool_execution_start":
        if (!event.parentToolCallId) next = { ...next, tools: [...next.tools, { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args, output: "" }] };
        break;
      case "tool_execution_update": {
        const out = event.output;
        if (!out) break;
        next = {
          ...next,
          tools: next.tools.map((t) => {
            if (t.toolCallId !== event.toolCallId) return t;
            if ("set" in out) return { ...t, output: out.set };
            return { ...t, output: t.output.slice(out.trimStart ?? 0) + (out.append ?? "") };
          }),
        };
        break;
      }
      case "tool_execution_end":
        next = {
          ...next,
          tools: next.tools.filter((t) => t.toolCallId !== event.toolCallId),
          entries: event.entry ? addEntry(next.entries, event.entry) : next.entries,
        };
        break;
      case "task_failed":
        next = { ...next, error: event.message };
        break;
    }
  }
  return next;
}

/** The chat's WebSocket: reconnects with backoff, and every (re)connect starts from a fresh snapshot. */
export function useChat(chatId: string) {
  const [state, dispatch] = useReducer(reduce, initial);
  const [connected, setConnected] = useState(false);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    dispatch({ type: "reset" });
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const open = () => {
      const ws = new WebSocket(api.chatSocketUrl(chatId));
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as ChatServerMessage;
        if (message.type === "events") dispatch({ type: "events", events: message.events as AgentEvent[] });
        else dispatch({ type: "error", message: message.message });
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        timer = setTimeout(open, Math.min(1_000 * 2 ** attempt++, 15_000));
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [chatId]);

  const send = (message: ChatClientMessage) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(JSON.stringify(message));
    return true;
  };

  return {
    state,
    connected,
    prompt: (text: string) => send({ type: "prompt", text }),
    abort: () => send({ type: "abort" }),
  };
}
