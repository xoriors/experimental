import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cacheKey, type CacheKeyParts, cacheKeyFor, readCache, writeCache } from "./cache.ts";
import { fromRoot, ROOT } from "./env.ts";
import { ANNOUNCE, pairState } from "./questions.ts";
import type { Pair } from "./types.ts";

// cacheKeyFor reads images through fromRoot, so the scratch files live under runs/ (gitignored).
mkdirSync(fromRoot("runs"), { recursive: true });
const tmp = mkdtempSync(fromRoot("runs", ".cache-test-"));
const rel = (name: string) => path.relative(ROOT, path.join(tmp, name));
writeFileSync(path.join(tmp, "a.png"), "image a");
writeFileSync(path.join(tmp, "b.png"), "image b");
writeFileSync(path.join(tmp, "c.png"), "image c");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const pair = (over: Partial<Pair> = {}): Pair =>
	({
		id: "p",
		before: rel("a.png"),
		after: rel("b.png"),
		labels: { announce: true, kind: "dialog", urgency: 3, sensitive: false, narrations: { supported: "A dialog", unsupported: "A toast" } },
		...over,
	}) as Pair;

describe("cacheKey", () => {
	const base: CacheKeyParts = { fingerprint: "liquid:d1-ultra", state: pairState(), questions: { announce: ANNOUNCE }, beforeSha: "a", afterSha: "b" };

	it("is stable for the same inputs", () => {
		expect(cacheKey(base)).toBe(cacheKey({ ...base }));
		expect(cacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
	});

	it("changes when question wording, fingerprint, state or an image changes", () => {
		const k = cacheKey(base);
		const reworded = { announce: { ...ANNOUNCE, instructions: `${ANNOUNCE.instructions} ` } };
		expect(cacheKey({ ...base, questions: reworded })).not.toBe(k);
		expect(cacheKey({ ...base, fingerprint: "liquid:d1" })).not.toBe(k);
		expect(cacheKey({ ...base, state: pairState('button "OK"') })).not.toBe(k);
		expect(cacheKey({ ...base, afterSha: "c" })).not.toBe(k);
		// Swapping before and after is a different question.
		expect(cacheKey({ ...base, beforeSha: "b", afterSha: "a" })).not.toBe(k);
	});
});

describe("cacheKeyFor", () => {
	it("follows image bytes, question set and the pair's own question text", () => {
		const k = cacheKeyFor("fp", pair(), "all");
		expect(cacheKeyFor("fp", pair(), "all")).toBe(k);
		expect(cacheKeyFor("fp", pair({ after: rel("c.png") }), "all")).not.toBe(k);
		expect(cacheKeyFor("fp", pair(), "core")).not.toBe(k);
		const p = pair();
		p.labels.narrations = { supported: "A dialog", unsupported: "A banner" };
		expect(cacheKeyFor("fp", p, "all")).not.toBe(k);
	});
});

describe("readCache / writeCache", () => {
	it("round-trips an entry and misses on unknown or corrupt files", () => {
		const dir = path.join(tmp, "cache");
		writeCache("k1", { prediction: { announce: 0.7 }, inputTokens: 10, costUsd: null }, 123, dir);
		expect(readCache("k1", dir)).toMatchObject({ output: { prediction: { announce: 0.7 }, inputTokens: 10, costUsd: null }, latencyMs: 123 });
		expect(readCache("nope", dir)).toBeUndefined();
		writeFileSync(path.join(dir, "bad.json"), "{");
		expect(readCache("bad", dir)).toBeUndefined();
	});
});
