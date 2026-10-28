import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WORKER = join(import.meta.dirname, "..", "worker");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

// The R2 bucket binding is FILES. Only worker/storage/ may touch it; everything
// else must go through Storage, which hands out per-user, encrypted UserFiles.
describe("storage boundary", () => {
  it("keeps every use of the R2 binding inside worker/storage/", () => {
    const offenders = sources(WORKER)
      .filter((file) => !relative(WORKER, file).startsWith("storage"))
      .filter((file) => /\bFILES\b|\bR2Bucket\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(WORKER, file));
    expect(offenders).toEqual([]);
  });
});
