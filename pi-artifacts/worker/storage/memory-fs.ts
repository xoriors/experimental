/**
 * The smallest filesystem isomorphic-git runs on: a Worker has no disk, and a
 * publish only ever holds one shallow checkout of a small repo, so a Map of
 * paths is enough. Errors carry the Node codes isomorphic-git checks for.
 */
type Node = { kind: "file"; data: Uint8Array; mtimeMs: number } | { kind: "dir"; mtimeMs: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fsError(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

function normalise(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

class Stat {
  readonly type: "file" | "dir";
  readonly mode: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly ino = 0;
  readonly uid = 1;
  readonly gid = 1;
  readonly dev = 1;

  constructor(node: Node) {
    this.type = node.kind;
    this.mode = node.kind === "file" ? 0o100644 : 0o40000;
    this.size = node.kind === "file" ? node.data.byteLength : 0;
    this.mtimeMs = this.ctimeMs = node.mtimeMs;
  }
  isFile() {
    return this.type === "file";
  }
  isDirectory() {
    return this.type === "dir";
  }
  isSymbolicLink() {
    return false;
  }
}

export class MemoryFS {
  readonly #nodes = new Map<string, Node>([["/", { kind: "dir", mtimeMs: Date.now() }]]);

  readonly promises = {
    readFile: async (path: string, options?: { encoding?: string } | string) => {
      const node = this.#nodes.get(normalise(path));
      if (!node) throw fsError("ENOENT", path);
      if (node.kind === "dir") throw fsError("EISDIR", path);
      const encoding = typeof options === "string" ? options : options?.encoding;
      return encoding === "utf8" ? decoder.decode(node.data) : node.data.slice();
    },

    writeFile: async (path: string, data: Uint8Array | string) => {
      const target = normalise(path);
      this.#mkdirs(parentOf(target));
      if (this.#nodes.get(target)?.kind === "dir") throw fsError("EISDIR", path);
      this.#nodes.set(target, { kind: "file", data: typeof data === "string" ? encoder.encode(data) : new Uint8Array(data), mtimeMs: Date.now() });
    },

    unlink: async (path: string) => {
      const target = normalise(path);
      if (this.#nodes.get(target)?.kind !== "file") throw fsError("ENOENT", path);
      this.#nodes.delete(target);
    },

    readdir: async (path: string) => {
      const dir = normalise(path);
      const node = this.#nodes.get(dir);
      if (!node) throw fsError("ENOENT", path);
      if (node.kind !== "dir") throw fsError("ENOTDIR", path);
      const prefix = dir === "/" ? "/" : `${dir}/`;
      return [...this.#nodes.keys()].filter((p) => p !== dir && p.startsWith(prefix) && !p.slice(prefix.length).includes("/")).map((p) => p.slice(prefix.length));
    },

    mkdir: async (path: string) => {
      const dir = normalise(path);
      if (this.#nodes.has(dir)) throw fsError("EEXIST", path);
      if (this.#nodes.get(parentOf(dir))?.kind !== "dir") throw fsError("ENOENT", path);
      this.#nodes.set(dir, { kind: "dir", mtimeMs: Date.now() });
    },

    rmdir: async (path: string) => {
      const dir = normalise(path);
      if (this.#nodes.get(dir)?.kind !== "dir") throw fsError("ENOENT", path);
      if ((await this.promises.readdir(dir)).length) throw fsError("ENOTEMPTY", path);
      this.#nodes.delete(dir);
    },

    stat: async (path: string) => {
      const node = this.#nodes.get(normalise(path));
      if (!node) throw fsError("ENOENT", path);
      return new Stat(node);
    },

    lstat: async (path: string) => this.promises.stat(path),

    // Artifact repos hold no symlinks; isomorphic-git only needs these to exist.
    readlink: async (path: string): Promise<string> => {
      throw fsError("EINVAL", path);
    },
    symlink: async (_target: string, path: string): Promise<void> => {
      throw fsError("EPERM", path);
    },
  };

  #mkdirs(dir: string): void {
    if (this.#nodes.has(dir)) {
      if (this.#nodes.get(dir)!.kind !== "dir") throw fsError("ENOTDIR", dir);
      return;
    }
    this.#mkdirs(parentOf(dir));
    this.#nodes.set(dir, { kind: "dir", mtimeMs: Date.now() });
  }
}
