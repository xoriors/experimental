import { DurableObject, exports } from "cloudflare:workers";
import type { ChatSummary } from "../shared/protocol.ts";
import type { McpAuthRecord, McpAuthStore } from "./mcp/oauth.ts";
import { mcpServers } from "./mcp/servers.ts";

export interface ArtifactSummary {
  id: string;
  title: string;
  chatId: string;
  latest: number;
  updatedAt: number;
}

/** One user's OAuth state for one MCP server. `uid` must come from a verified identity. */
export function mcpAuthStore(uid: string, server: string): McpAuthStore {
  const directory = exports.UserDirectory.getByName(uid);
  return { get: () => directory.mcpAuth(server), put: (record) => directory.setMcpAuth(server, record) };
}

/** One per user: the index of their chats and artifacts. The chats themselves live in ChatAgent objects. */
export class UserDirectory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, title TEXT NOT NULL, chat_id TEXT NOT NULL, latest INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_auth (server TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
    // Forget sign-ins to servers this deployment no longer has, tokens included.
    const configured = mcpServers(env).map((server) => server.name);
    const placeholders = configured.map(() => "?").join(", ");
    ctx.storage.sql.exec(`DELETE FROM mcp_auth${configured.length ? ` WHERE server NOT IN (${placeholders})` : ""}`, ...configured);
  }

  /** This user's OAuth state for one MCP server (worker/mcp/oauth.ts): registration, tokens, a sign-in in progress. */
  mcpAuth(server: string): McpAuthRecord {
    const row = this.ctx.storage.sql.exec<{ data: string }>("SELECT data FROM mcp_auth WHERE server = ?", server).toArray()[0];
    return row ? (JSON.parse(row.data) as McpAuthRecord) : {};
  }

  setMcpAuth(server: string, record: McpAuthRecord): void {
    if (Object.keys(record).length === 0) this.ctx.storage.sql.exec("DELETE FROM mcp_auth WHERE server = ?", server);
    else this.ctx.storage.sql.exec("INSERT INTO mcp_auth (server, data) VALUES (?, ?) ON CONFLICT(server) DO UPDATE SET data = excluded.data", server, JSON.stringify(record));
  }

  listChats(): ChatSummary[] {
    return this.ctx.storage.sql
      .exec<{ id: string; title: string; created_at: number; updated_at: number }>("SELECT * FROM chats ORDER BY updated_at DESC")
      .toArray()
      .map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  createChat(id: string): ChatSummary {
    const now = Date.now();
    this.ctx.storage.sql.exec("INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", id, "New chat", now, now);
    return { id, title: "New chat", createdAt: now, updatedAt: now };
  }

  hasChat(id: string): boolean {
    return this.ctx.storage.sql.exec("SELECT 1 FROM chats WHERE id = ?", id).toArray().length > 0;
  }

  /** Bump a chat to the top; name it after its first prompt. */
  touchChat(id: string, firstPrompt?: string): void {
    const now = Date.now();
    this.ctx.storage.sql.exec("UPDATE chats SET updated_at = ? WHERE id = ?", now, id);
    if (firstPrompt) {
      const title = firstPrompt.replace(/\s+/g, " ").trim().slice(0, 60) || "New chat";
      this.ctx.storage.sql.exec("UPDATE chats SET title = ? WHERE id = ? AND title = 'New chat'", title, id);
    }
  }

  listArtifacts(): ArtifactSummary[] {
    return this.ctx.storage.sql
      .exec<{ id: string; title: string; chat_id: string; latest: number; updated_at: number }>("SELECT * FROM artifacts ORDER BY updated_at DESC")
      .toArray()
      .map((row) => ({ id: row.id, title: row.title, chatId: row.chat_id, latest: row.latest, updatedAt: row.updated_at }));
  }

  recordArtifact(artifact: ArtifactSummary): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO artifacts (id, title, chat_id, latest, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, latest = excluded.latest, updated_at = excluded.updated_at`,
      artifact.id,
      artifact.title,
      artifact.chatId,
      artifact.latest,
      artifact.updatedAt,
    );
  }
}
