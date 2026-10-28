import type { ArtifactManifest, ArtifactMeta } from "../../shared/protocol.ts";
import { commitAndPush, type GitHttp } from "./git.ts";

const BRANCH = "main";
const PAGE_FILE = "index.html";
const META_FILE = "artifact.json";
/** How long a write token minted for one publish lives. It is revoked as soon as the push is done. */
const PUBLISH_TOKEN_TTL_S = 300;

const repoName = (id: string) => `artifact-${id}`;
const tagFor = (version: number) => `v${version}`;
// The R2 read cache keeps the layout artifacts had before repos, so artifacts
// published then still serve from it.
const metaKey = (id: string) => `artifacts/${id}/meta.json`;
const htmlKey = (id: string, version: number) => `artifacts/${id}/v${version}/index.html`;

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CloneAccess {
  remote: string;
  /** A read-only token for this one repo. */
  token: string;
  expiresAt: string;
}

/**
 * Published artifacts, one Git repo each in Cloudflare Artifacts: every
 * publish is a commit tagged v<n> holding index.html and artifact.json (the
 * metadata, manifests included). The repo is the source of truth; R2 keeps a
 * copy of each version and of the latest metadata, so page views and live
 * calls never touch Git.
 *
 * Artifacts are shared by link (anyone the app lets in can view one), so they
 * are not encrypted per user; writes check that the caller owns the artifact.
 */
export class ArtifactStore {
  readonly #repos: Artifacts;
  readonly #cache: R2Bucket;
  readonly #http?: GitHttp;

  constructor(repos: Artifacts, cache: R2Bucket, options: { http?: GitHttp } = {}) {
    this.#repos = repos;
    this.#cache = cache;
    this.#http = options.http;
  }

  async readMeta(id: string): Promise<ArtifactMeta | null> {
    const cached = await this.#cache.get(metaKey(id));
    if (cached) return (await cached.json()) as ArtifactMeta;
    const meta = await this.#readRepoMeta(id);
    if (meta) await this.#cacheMeta(meta);
    return meta;
  }

  async readHtml(id: string, version: number): Promise<string | null> {
    const cached = await this.#cache.get(htmlKey(id, version));
    if (cached) return cached.text();
    const html = await this.#withRepo(id, async (repo) => {
      const file = await repo.readFile({ ref: tagFor(version), path: PAGE_FILE });
      return file ? file.text() : null;
    });
    if (html !== null) await this.#cacheHtml(id, version, html);
    return html;
  }

  /** A short-lived read token for `git clone`. The caller checks that the user owns the artifact. */
  async cloneAccess(id: string, ttlSeconds = 900): Promise<CloneAccess | null> {
    return this.#withRepo(id, async (repo) => {
      const [info, token] = await Promise.all([repo.info(), repo.createToken("read", ttlSeconds)]);
      return { remote: info.remote, token: token.plaintext.split("?expires=")[0], expiresAt: token.expiresAt };
    });
  }

  /**
   * Commit a new version and push it. Only the chat that created an artifact
   * publishes to it, and a chat's Durable Object handles one call at a time,
   * so two publishes to one repo cannot race.
   */
  async publishVersion(input: {
    id?: string;
    ownerUid: string;
    chatId: string;
    title: string;
    html: string;
    manifest: ArtifactManifest;
    message?: string;
  }): Promise<ArtifactMeta> {
    const now = Date.now();
    let meta: ArtifactMeta;
    let createdToken: string | undefined;
    if (input.id) {
      const existing = (await this.#readRepoMeta(input.id)) ?? (await this.#importFromCache(input.id));
      if (!existing) throw new Error(`No artifact ${input.id}.`);
      if (existing.ownerUid !== input.ownerUid || existing.chatId !== input.chatId) {
        throw new Error(`Artifact ${input.id} belongs to another chat; publish a new artifact instead.`);
      }
      meta = existing;
    } else {
      meta = { id: newId(), title: input.title, ownerUid: input.ownerUid, chatId: input.chatId, createdAt: now, updatedAt: now, latest: 0, versions: [] };
      createdToken = (await this.#repos.create(repoName(meta.id), { description: input.title, setDefaultBranch: BRANCH })).token;
    }

    const version = meta.latest + 1;
    const message = input.message?.trim().split("\n")[0].slice(0, 200) || undefined;
    meta = {
      ...meta,
      title: input.title,
      updatedAt: now,
      latest: version,
      versions: [...meta.versions, { version, publishedAt: now, manifest: input.manifest, ...(message ? { message } : {}) }],
    };
    await this.#commit(meta, input.html, now, createdToken);
    await this.#cacheHtml(meta.id, version, input.html);
    await this.#cacheMeta(meta);
    return meta;
  }

  /**
   * Commit one version (index.html and artifact.json as of that version) with
   * a write token minted for this push only. `createdToken` is the write token
   * create() hands back, valid for a day: it is revoked here too, unused.
   */
  async #commit(meta: ArtifactMeta, html: string, at: number, createdToken?: string): Promise<void> {
    const entry = meta.versions[meta.versions.length - 1];
    await this.#withRepo(meta.id, async (repo) => {
      const [info, token] = await Promise.all([repo.info(), repo.createToken("write", PUBLISH_TOKEN_TTL_S)]);
      try {
        await commitAndPush({
          remote: info.remote,
          token: token.plaintext,
          branch: BRANCH,
          empty: entry.version === 1,
          files: { [PAGE_FILE]: html, [META_FILE]: `${JSON.stringify(meta, null, 2)}\n` },
          message: `${tagFor(entry.version)}: ${entry.message ?? meta.title}`,
          tag: tagFor(entry.version),
          at,
          http: this.#http,
        });
      } finally {
        await repo.revokeToken(token.id).catch(() => false);
        if (createdToken) await repo.revokeToken(createdToken).catch(() => false);
      }
    }, { required: true });
  }

  /**
   * An artifact published before repos existed has only its R2 copy. Replay
   * its versions into a new repo, one commit each, before adding to it.
   */
  async #importFromCache(id: string): Promise<ArtifactMeta | null> {
    const cached = await this.#cache.get(metaKey(id));
    if (!cached) return null;
    const legacy = (await cached.json()) as ArtifactMeta;
    // A repo without artifact.json on main holds nothing yet (an import that
    // stopped before its first push): start it again.
    await this.#repos.delete(repoName(id)).catch(() => false);
    let createdToken: string | undefined = (await this.#repos.create(repoName(id), { description: legacy.title, setDefaultBranch: BRANCH })).token;
    for (const entry of legacy.versions) {
      const html = await (await this.#cache.get(htmlKey(id, entry.version)))?.text();
      if (html === undefined) throw new Error(`Artifact ${id} is missing version ${entry.version}; it cannot be imported.`);
      const asOf: ArtifactMeta = { ...legacy, latest: entry.version, updatedAt: entry.publishedAt, versions: legacy.versions.filter((v) => v.version <= entry.version) };
      await this.#commit(asOf, html, entry.publishedAt, createdToken);
      createdToken = undefined;
    }
    return legacy;
  }

  async #readRepoMeta(id: string): Promise<ArtifactMeta | null> {
    return this.#withRepo(id, async (repo) => {
      const file = await repo.readFile({ ref: BRANCH, path: META_FILE });
      return file ? (JSON.parse(await file.text()) as ArtifactMeta) : null;
    });
  }

  /** Run `use` with the artifact's repo handle, then release it. Null when there is no repo, unless it is required. */
  async #withRepo<T>(id: string, use: (repo: ArtifactsRepo) => Promise<T>, options: { required?: boolean } = {}): Promise<T | null> {
    let repo: ArtifactsRepo;
    try {
      repo = await this.#repos.get(repoName(id));
    } catch (error) {
      if (!options.required && (error as { code?: string }).code === "NOT_FOUND") return null;
      throw error;
    }
    try {
      return await use(repo);
    } finally {
      repo[Symbol.dispose]();
    }
  }

  // The cache is only ever a copy of what the repo holds. If writing it fails,
  // drop the metadata so the next read refills it from the repo, rather than
  // serving a stale latest version.
  async #cacheMeta(meta: ArtifactMeta): Promise<void> {
    try {
      await this.#cache.put(metaKey(meta.id), JSON.stringify(meta), { httpMetadata: { contentType: "application/json" } });
    } catch {
      await this.#cache.delete(metaKey(meta.id)).catch(() => {});
    }
  }

  async #cacheHtml(id: string, version: number, html: string): Promise<void> {
    await this.#cache.put(htmlKey(id, version), html, { httpMetadata: { contentType: "text/html; charset=utf-8" } }).catch(() => {});
  }
}
