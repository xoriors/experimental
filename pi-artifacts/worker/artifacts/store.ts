import type { ArtifactManifest, ArtifactMeta } from "../../shared/protocol.ts";
import type { McpHub } from "../mcp/hub.ts";

export const MAX_HTML_BYTES = 2 * 1024 * 1024;

const metaKey = (id: string) => `artifacts/${id}/meta.json`;
const htmlKey = (id: string, version: number) => `artifacts/${id}/v${version}/index.html`;

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readMeta(bucket: R2Bucket, id: string): Promise<ArtifactMeta | null> {
  const object = await bucket.get(metaKey(id));
  return object ? ((await object.json()) as ArtifactMeta) : null;
}

export async function readHtml(bucket: R2Bucket, id: string, version: number): Promise<string | null> {
  const object = await bucket.get(htmlKey(id, version));
  return object ? object.text() : null;
}

/**
 * Store a new version. Only the chat that created an artifact publishes to it,
 * and a chat's Durable Object handles one call at a time, so the
 * read-modify-write of meta.json cannot race.
 */
export async function publishVersion(
  bucket: R2Bucket,
  input: { id?: string; ownerUid: string; chatId: string; title: string; html: string; manifest: ArtifactManifest },
): Promise<ArtifactMeta> {
  const now = Date.now();
  let meta: ArtifactMeta;
  if (input.id) {
    const existing = await readMeta(bucket, input.id);
    if (!existing) throw new Error(`No artifact ${input.id}.`);
    if (existing.ownerUid !== input.ownerUid || existing.chatId !== input.chatId) {
      throw new Error(`Artifact ${input.id} belongs to another chat; publish a new artifact instead.`);
    }
    meta = existing;
  } else {
    meta = { id: newId(), title: input.title, ownerUid: input.ownerUid, chatId: input.chatId, createdAt: now, updatedAt: now, latest: 0, versions: [] };
  }
  const version = meta.latest + 1;
  await bucket.put(htmlKey(meta.id, version), input.html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  meta = {
    ...meta,
    title: input.title,
    updatedAt: now,
    latest: version,
    versions: [...meta.versions, { version, publishedAt: now, manifest: input.manifest }],
  };
  await bucket.put(metaKey(meta.id), JSON.stringify(meta), { httpMetadata: { contentType: "application/json" } });
  return meta;
}

/**
 * Check a manifest against the servers and tools this chat actually has, as
 * Claude checks declared tool names at publish. Returns the problems found;
 * an empty list means the manifest is valid.
 */
export async function checkManifest(hub: McpHub, manifest: ArtifactManifest): Promise<string[]> {
  const problems: string[] = [];
  const known = new Set(hub.servers().map((server) => server.name));
  for (const entry of manifest.mcp?.servers ?? []) {
    if (!known.has(entry.server)) {
      problems.push(`Unknown MCP server "${entry.server}". Connected servers: ${[...known].join(", ")}.`);
      continue;
    }
    if (entry.tools.length === 0) {
      problems.push(`"${entry.server}" declares no tools; list every tool the page calls.`);
      continue;
    }
    const tools = new Set((await hub.tools(entry.server)).map((tool) => tool.name));
    for (const tool of entry.tools) {
      if (!tools.has(tool)) problems.push(`"${entry.server}" has no tool "${tool}". Its tools: ${[...tools].join(", ")}.`);
    }
  }
  return problems;
}
