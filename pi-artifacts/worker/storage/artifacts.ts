import type { ArtifactManifest, ArtifactMeta } from "../../shared/protocol.ts";

const metaKey = (id: string) => `artifacts/${id}/meta.json`;
const htmlKey = (id: string, version: number) => `artifacts/${id}/v${version}/index.html`;

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Published artifacts. They are shared by link (anyone the app lets in can
 * view one), so they are not encrypted per user; writes check that the
 * caller owns the artifact.
 */
export class ArtifactStore {
  readonly #bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket;
  }

  async readMeta(id: string): Promise<ArtifactMeta | null> {
    const object = await this.#bucket.get(metaKey(id));
    return object ? ((await object.json()) as ArtifactMeta) : null;
  }

  async readHtml(id: string, version: number): Promise<string | null> {
    const object = await this.#bucket.get(htmlKey(id, version));
    return object ? object.text() : null;
  }

  /**
   * Store a new version. Only the chat that created an artifact publishes to it,
   * and a chat's Durable Object handles one call at a time, so the
   * read-modify-write of meta.json cannot race.
   */
  async publishVersion(input: {
    id?: string;
    ownerUid: string;
    chatId: string;
    title: string;
    html: string;
    manifest: ArtifactManifest;
  }): Promise<ArtifactMeta> {
    const now = Date.now();
    let meta: ArtifactMeta;
    if (input.id) {
      const existing = await this.readMeta(input.id);
      if (!existing) throw new Error(`No artifact ${input.id}.`);
      if (existing.ownerUid !== input.ownerUid || existing.chatId !== input.chatId) {
        throw new Error(`Artifact ${input.id} belongs to another chat; publish a new artifact instead.`);
      }
      meta = existing;
    } else {
      meta = { id: newId(), title: input.title, ownerUid: input.ownerUid, chatId: input.chatId, createdAt: now, updatedAt: now, latest: 0, versions: [] };
    }
    const version = meta.latest + 1;
    await this.#bucket.put(htmlKey(meta.id, version), input.html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    meta = {
      ...meta,
      title: input.title,
      updatedAt: now,
      latest: version,
      versions: [...meta.versions, { version, publishedAt: now, manifest: input.manifest }],
    };
    await this.#bucket.put(metaKey(meta.id), JSON.stringify(meta), { httpMetadata: { contentType: "application/json" } });
    return meta;
  }
}
