import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useChat, type RunningTool } from "./useChat.ts";
import { Linkified } from "./Linkified.tsx";
import { Markdown } from "./Markdown.tsx";

export interface PublishedArtifact {
  artifactId: string;
  version: number;
  title: string;
}

interface Props {
  chatId: string;
  /** Called with the newest artifact this chat published, on load and on every publish. */
  onArtifact: (artifact: PublishedArtifact) => void;
  onActivity: () => void;
}

function published(entry: EntryRecord): PublishedArtifact | undefined {
  if (entry.kind !== "pi.tool-result") return undefined;
  const message = entry.model?.[0] as ToolResultMessage | undefined;
  if (message?.toolName !== "artifact_publish" || message.isError) return undefined;
  const details = message.details as Partial<PublishedArtifact> | undefined;
  return details?.artifactId && details.version ? (details as PublishedArtifact) : undefined;
}

export function ChatView({ chatId, onArtifact, onActivity }: Props) {
  const { state, connected, prompt, abort } = useChat(chatId);
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastArtifact = useRef<string>("");

  // Follow new output only while the reader is at the bottom; scrolling up to read stops it,
  // scrolling back down (or sending a message) resumes it. Scroll the list itself, never the page.
  const following = useRef(true);
  const onScroll = () => {
    const el = list.current;
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    const el = list.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [state.entries.length, state.partial, state.tools]);

  // A finished run may have renamed the chat or published artifacts: refresh the sidebar.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !state.busy) onActivity();
    wasBusy.current = state.busy;
  }, [state.busy, onActivity]);

  useEffect(() => {
    const latest = state.entries.map(published).filter(Boolean).pop();
    if (!latest) return;
    const key = `${latest.artifactId}:${latest.version}`;
    if (key === lastArtifact.current) return;
    lastArtifact.current = key;
    onArtifact(latest);
  }, [state.entries, onArtifact]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !prompt(text)) return;
    following.current = true;
    setDraft("");
    onActivity();
    // Clicking Send moves focus to the button; keep typing where you were.
    input.current?.focus();
  };

  // Enter sends, Shift+Enter adds a line. Not while an IME is composing (Enter then confirms the text).
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <section className="chat">
      <div className="messages" ref={list} onScroll={onScroll}>
        {state.entries.length === 0 && !state.busy && (
          <div className="empty-chat">
            <h2>What should we build?</h2>
            <p>Try: “A live crypto dashboard for BTC, ETH and SOL with 24 h change and a 7-day price chart, refreshing every 30 seconds.”</p>
          </div>
        )}
        {state.entries.map((entry) => (
          <Entry key={entry.id} entry={entry} onOpen={onArtifact} />
        ))}
        {state.partial && <Assistant message={state.partial} streaming />}
        {state.tools.map((tool) => (
          <Running key={tool.toolCallId} tool={tool} />
        ))}
        {state.busy && !state.partial && state.tools.length === 0 && <div className="thinking">Thinking…</div>}
        {state.error && <div className="chat-error">{state.error}</div>}
      </div>
      <form className="composer" onSubmit={submit}>
        <textarea
          ref={input}
          // Each chat mounts its own view, so a new or opened chat starts with the cursor here.
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={connected ? "Describe a dashboard…" : "Connecting…"}
          rows={2}
        />
        {state.busy ? (
          <button type="button" onClick={abort}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!connected || !draft.trim()}>
            Send
          </button>
        )}
      </form>
    </section>
  );
}

function Entry({ entry, onOpen }: { entry: EntryRecord; onOpen: (artifact: PublishedArtifact) => void }) {
  const message = entry.model?.[0];
  if (entry.kind === "pi.user" && message?.role === "user") return <User message={message} />;
  if (entry.kind === "pi.assistant" && message?.role === "assistant") return <Assistant message={message} />;
  if (entry.kind === "pi.tool-result" && message?.role === "toolResult") {
    const artifact = published(entry);
    if (artifact) {
      return (
        <button type="button" className="artifact-card" onClick={() => onOpen(artifact)}>
          <span className="artifact-card-icon">▦</span>
          <span>
            <strong>{artifact.title}</strong>
            <small>Artifact · version {artifact.version} · open preview</small>
          </span>
        </button>
      );
    }
    return <ToolResult message={message} />;
  }
  return null;
}

/** A message's blocks, skipping any slot a stream has not filled yet. */
function blocks<T>(content: string | readonly (T | undefined | null)[]): T[] {
  return typeof content === "string" ? [] : content.filter((b): b is T => b != null);
}

function User({ message }: { message: UserMessage }) {
  const text = typeof message.content === "string" ? message.content : blocks(message.content).map((b) => (b.type === "text" ? b.text : "")).join("");
  return <div className="bubble user">{text}</div>;
}

function Assistant({ message, streaming }: { message: AssistantMessage; streaming?: boolean }) {
  return (
    <div className={streaming ? "assistant streaming" : "assistant"}>
      {blocks(message.content).map((block, i) => {
        if (block.type === "text")
          return block.text ? (
            <div key={i} className="bubble bot markdown">
              <Markdown text={block.text} />
            </div>
          ) : null;
        if (block.type === "toolCall") return <div key={i} className="tool-call">→ {block.name}</div>;
        return null;
      })}
      {message.stopReason === "error" && <div className="chat-error">The model failed: {message.errorMessage ?? "unknown error"}</div>}
      {message.stopReason === "aborted" && <div className="tool-call">Stopped.</div>}
    </div>
  );
}

function ToolResult({ message }: { message: ToolResultMessage }) {
  const text = blocks(message.content).map((b) => (b.type === "text" ? b.text : "[image]")).join("\n");
  return (
    <details className={message.isError ? "tool-result error" : "tool-result"}>
      <summary>
        {message.isError ? "✕" : "✓"} {message.toolName}
      </summary>
      <pre>
        <Linkified text={text.length > 4_000 ? `${text.slice(0, 4_000)}…` : text} />
      </pre>
    </details>
  );
}

function Running({ tool }: { tool: RunningTool }) {
  return (
    <div className="tool-call running">
      <span className="spinner" /> {tool.toolName}
      {tool.output && <pre>{tool.output.slice(-600)}</pre>}
    </div>
  );
}
