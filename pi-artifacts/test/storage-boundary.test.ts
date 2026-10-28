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

// The R2 bucket binding is FILES and the Artifacts binding is REPOS. Only
// worker/storage/ may touch them; everything else must go through Storage,
// which hands out per-user, encrypted UserFiles and the ArtifactStore.
describe("storage boundary", () => {
  it("keeps every use of the R2 and Artifacts bindings inside worker/storage/", () => {
    const offenders = sources(WORKER)
      .filter((file) => !relative(WORKER, file).startsWith("storage"))
      .filter((file) => /\bFILES\b|\bR2Bucket\b|\bREPOS\b|\bArtifactsRepo\b|:\s*Artifacts\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(WORKER, file));
    expect(offenders).toEqual([]);
  });
});
