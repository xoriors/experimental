import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ArtifactMeta } from "../shared/protocol.ts";
import { ArtifactStore } from "../worker/storage/artifacts.ts";

// The store's Git code runs for real here: isomorphic-git pushes over HTTP to
// git http-backend, standing in for Cloudflare Artifacts. The binding itself is
// a fake with the same shape (create/get/delete, repo-scoped tokens, readFile).

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
// Anything that talks to the server must not block: it runs in this process.
const gitRemote = (...args: string[]) => promisify(execFile)("git", args, { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

interface Token {
  id: string;
  secret: string;
  scope: "read" | "write";
  repo: string;
  active: boolean;
}

class FakeArtifacts {
  readonly tokens: Token[] = [];
  constructor(
    readonly root: string,
    readonly origin: string,
  ) {}

  #dir(name: string) {
    return join(this.root, `${name}.git`);
  }

  #mint(repo: string, scope: "read" | "write") {
    const token: Token = { id: `tok${this.tokens.length}`, secret: `art_v1_${crypto.randomUUID()}`, scope, repo, active: true };
    this.tokens.push(token);
    return token;
  }

  async create(name: string, opts: { setDefaultBranch?: string } = {}) {
    if (existsSync(this.#dir(name))) throw Object.assign(new Error("exists"), { code: "ALREADY_EXISTS" });
    git("init", "--bare", "-q", `--initial-branch=${opts.setDefaultBranch ?? "main"}`, this.#dir(name));
    const token = this.#mint(name, "write");
    return { id: name, name, description: null, defaultBranch: "main", remote: `${this.origin}/${name}.git`, token: `${token.secret}?expires=1` };
  }

  async delete(name: string) {
    if (!existsSync(this.#dir(name))) return false;
    rmSync(this.#dir(name), { recursive: true });
    return true;
  }

  async get(name: string) {
    const dir = this.#dir(name);
    if (!existsSync(dir)) throw Object.assign(new Error("no repo"), { code: "NOT_FOUND" });
    return {
      info: async () => ({ name, remote: `${this.origin}/${name}.git` }),
      createToken: async (scope: "read" | "write" = "write", ttl = 86_400) => {
        const token = this.#mint(name, scope);
        return { id: token.id, plaintext: `${token.secret}?expires=${ttl}`, scope, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
      },
      revokeToken: async (id: string) => {
        const token = this.tokens.find((t) => t.id === id || t.secret === id.split("?expires=")[0]);
        if (token) token.active = false;
        return Boolean(token);
      },
      readFile: async ({ ref, path }: { ref: string; path: string }) => {
        try {
          return new Blob([execFileSync("git", ["--git-dir", dir, "show", `${ref}:${path}`], { stdio: "pipe" })]);
        } catch {
          return null;
        }
      },
      [Symbol.dispose]: () => {},
    };
  }

  /** Which token, if any, lets this request through. Pushes need an active write token for the same repo. */
  allows(repo: string, push: boolean, authorization: string | undefined): boolean {
    const password = authorization?.startsWith("Basic ") ? Buffer.from(authorization.slice(6), "base64").toString().split(":")[1] : undefined;
    const token = this.tokens.find((t) => t.secret === password);
    return Boolean(token?.active && token.repo === repo && (!push || token.scope === "write"));
  }
}

/** git http-backend behind a tiny CGI shim, checking tokens the way Artifacts does. */
function serveGit(root: string, artifacts: () => FakeArtifacts): Server {
  return createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const repo = url.pathname.split("/")[1]?.replace(/\.git$/, "");
    const push = url.pathname.endsWith("git-receive-pack") || url.searchParams.get("service") === "git-receive-pack";
    if (!artifacts().allows(repo, push, req.headers.authorization)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="artifacts"' }).end();
      return;
    }
    const cgi = spawn(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim() + "/git-http-backend", [], {
      env: {
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        REMOTE_USER: "x",
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method!,
        CONTENT_TYPE: req.headers["content-type"] ?? "",
        HTTP_CONTENT_ENCODING: req.headers["content-encoding"] ?? "",
      },
    });
    req.pipe(cgi.stdin);
    const chunks: Buffer[] = [];
    cgi.stdout.on("data", (c: Buffer) => chunks.push(c));
    cgi.on("close", () => {
      const out = Buffer.concat(chunks);
      const split = out.indexOf("\r\n\r\n");
      const head = out.subarray(0, split).toString().split("\r\n");
      const headers: Record<string, string> = {};
      let status = 200;
      for (const line of head) {
        const [key, ...rest] = line.split(":");
        if (key.toLowerCase() === "status") status = Number(rest.join(":").trim().split(" ")[0]);
        else headers[key] = rest.join(":").trim();
      }
      res.writeHead(status, headers).end(out.subarray(split + 4));
    });
  });
}

class FakeBucket {
  readonly objects = new Map<string, string>();
  async get(key: string) {
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value, json: async () => JSON.parse(value) };
  }
  async put(key: string, value: string) {
    this.objects.set(key, value);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

let root: string;
let server: Server;
let artifacts: FakeArtifacts;
let bucket: FakeBucket;
let store: ArtifactStore;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "artifacts-"));
  server = serveGit(root, () => artifacts);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  const { port } = server.address() as AddressInfo;
  artifacts = new FakeArtifacts(root, `http://127.0.0.1:${port}`);
  bucket = new FakeBucket();
  store = new ArtifactStore(artifacts, bucket);
});

const publish = (input: Partial<Parameters<ArtifactStore["publishVersion"]>[0]> = {}) =>
  store.publishVersion({ ownerUid: "ada", chatId: "chat1", title: "Prices", html: "<p>one</p>", manifest: {}, ...input });

const repoDir = (meta: ArtifactMeta) => join(root, `artifact-${meta.id}.git`);

describe("ArtifactStore on Git repos", () => {
  it("commits each version, tags it, and keeps a copy in the cache", async () => {
    const v1 = await publish({ message: "First cut" });
    const v2 = await publish({ id: v1.id, html: "<p>two</p>", message: "Darker colours\nsecond line is dropped" });

    expect(v2.latest).toBe(2);
    expect(v2.versions.map((v) => v.message)).toEqual(["First cut", "Darker colours"]);
    const dir = repoDir(v2);
    expect(git("--git-dir", dir, "log", "--format=%s", "main").trim().split("\n")).toEqual(["v2: Darker colours", "v1: First cut"]);
    expect(git("--git-dir", dir, "tag").trim().split("\n")).toEqual(["v1", "v2"]);
    expect(git("--git-dir", dir, "show", "v1:index.html")).toBe("<p>one</p>");
    expect(JSON.parse(git("--git-dir", dir, "show", "main:artifact.json"))).toEqual(v2);
    expect(bucket.objects.get(`artifacts/${v2.id}/v2/index.html`)).toBe("<p>two</p>");
  });

  it("reads from the repo when the cache is empty, and refills it", async () => {
    const meta = await publish();
    await publish({ id: meta.id, html: "<p>two</p>" });
    bucket.objects.clear();

    expect(await store.readHtml(meta.id, 1)).toBe("<p>one</p>");
    expect((await store.readMeta(meta.id))?.latest).toBe(2);
    expect(bucket.objects.has(`artifacts/${meta.id}/v1/index.html`)).toBe(true);
    expect(await store.readHtml(meta.id, 9)).toBeNull();
    expect(await store.readMeta("0000000000000000")).toBeNull();
  });

  it("refuses a publish from another owner or chat", async () => {
    const meta = await publish();
    await expect(publish({ id: meta.id, ownerUid: "bob" })).rejects.toThrow(/belongs to another chat/);
    await expect(publish({ id: meta.id, chatId: "chat2" })).rejects.toThrow(/belongs to another chat/);
    await expect(publish({ id: "0000000000000000" })).rejects.toThrow(/No artifact/);
  });

  it("leaves no write token active after a publish", async () => {
    const meta = await publish();
    await publish({ id: meta.id, html: "<p>two</p>" });
    // create()'s token, then one per push.
    expect(artifacts.tokens.filter((t) => t.scope === "write")).toHaveLength(3);
    expect(artifacts.tokens.filter((t) => t.active)).toEqual([]);
  });

  it("imports an artifact published before repos, then adds to it", async () => {
    const legacy: ArtifactMeta = {
      id: "1234abcd1234abcd",
      title: "Old",
      ownerUid: "ada",
      chatId: "chat1",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      latest: 2,
      versions: [
        { version: 1, publishedAt: 1_700_000_000_000, manifest: {} },
        { version: 2, publishedAt: 1_700_000_100_000, manifest: { mcp: { servers: [{ server: "CoinGecko", tools: ["execute"] }] } } },
      ],
    };
    bucket.objects.set(`artifacts/${legacy.id}/meta.json`, JSON.stringify(legacy));
    bucket.objects.set(`artifacts/${legacy.id}/v1/index.html`, "<p>old one</p>");
    bucket.objects.set(`artifacts/${legacy.id}/v2/index.html`, "<p>old two</p>");

    // Before anything is published to it, it still serves from the cache.
    expect(await store.readHtml(legacy.id, 2)).toBe("<p>old two</p>");

    const v3 = await publish({ id: legacy.id, html: "<p>new</p>", message: "Now in Git" });
    const dir = repoDir(v3);
    expect(git("--git-dir", dir, "log", "--format=%s %at", "main").trim().split("\n")).toEqual([
      expect.stringMatching(/^v3: Now in Git \d+$/),
      "v2: Old 1700000100",
      "v1: Old 1700000000",
    ]);
    expect(git("--git-dir", dir, "show", "v1:index.html")).toBe("<p>old one</p>");
    expect(JSON.parse(git("--git-dir", dir, "show", "v2:artifact.json")).versions).toEqual(legacy.versions);
  });

  it("hands out a read-only token that clones this repo and no other", async () => {
    const mine = await publish();
    const other = await publish({ ownerUid: "bob", chatId: "chat9" });
    const access = (await store.cloneAccess(mine.id))!;
    const withToken = (remote: string) => remote.replace("http://", `http://x:${access.token}@`);

    const into = join(root, `clone-${mine.id}`);
    await gitRemote("clone", "-q", withToken(access.remote), into);
    expect(git("-C", into, "log", "--format=%s").trim()).toBe("v1: Prices");

    const otherRemote = access.remote.replace(mine.id, other.id);
    await expect(gitRemote("clone", "-q", withToken(otherRemote), join(root, "nope"))).rejects.toThrow();
    await expect(gitRemote("-C", into, "push", "-q", "origin", "HEAD:main")).rejects.toThrow();
    expect(await store.cloneAccess("0000000000000000")).toBeNull();
  });
});
