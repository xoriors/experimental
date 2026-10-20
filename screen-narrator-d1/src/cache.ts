// The API-response cache for paid backends: runs/cache/<key>.json. The key covers everything that changes an answer
// (backend settings, the exact state and questions sent, the image bytes), so editing question wording in
// questions.ts re-asks instead of serving a stale answer. Errors are never cached. The read/write helpers also hold
// pixel-diff's changed fractions (runs/cache/pixel-diff), which are free but slow enough to be worth keeping.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fromRoot } from "./env.ts";
import type { BackendOutput } from "./backends/types.ts";
import { pairState, questionsFor } from "./questions.ts";
import type { Pair, QuestionSet } from "./types.ts";

export const CACHE_DIR = fromRoot("runs", "cache");

export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

export interface CacheKeyParts {
	fingerprint: string;
	state: unknown;
	questions: unknown;
	beforeSha: string;
	afterSha: string;
}

export const cacheKey = (parts: CacheKeyParts): string =>
	sha256(JSON.stringify([parts.fingerprint, parts.state, parts.questions, parts.beforeSha, parts.afterSha]));

/**
 * The key for one backend × pair × question set, hashing the image files as they are on disk now (or `bytes`, the
 * same files already read by the caller).
 */
export function cacheKeyFor(fingerprint: string, pair: Pair, set: QuestionSet, bytes?: { before: Buffer; after: Buffer }): string {
	return cacheKey({
		fingerprint,
		state: pairState(pair.focused),
		questions: questionsFor(pair, set),
		beforeSha: sha256(bytes?.before ?? readFileSync(fromRoot(pair.before))),
		afterSha: sha256(bytes?.after ?? readFileSync(fromRoot(pair.after))),
	});
}

/** What a cache file holds: the answer plus the latency of the call that produced it, so reports stay honest. */
export interface CacheEntry {
	output: BackendOutput;
	latencyMs: number;
	createdAt: string;
}

/** Any JSON value stored as `<dir>/<key>.json`; undefined on a miss. */
export function readJsonCache<T>(key: string, dir = CACHE_DIR): T | undefined {
	const file = path.join(dir, `${key}.json`);
	if (!existsSync(file)) return undefined;
	try {
		return JSON.parse(readFileSync(file, "utf8")) as T;
	} catch {
		return undefined; // a truncated write from an interrupted run: treat as a miss and overwrite it
	}
}

export function writeJsonCache(key: string, value: unknown, dir = CACHE_DIR): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(value, null, 1));
}

export const readCache = (key: string, dir = CACHE_DIR): CacheEntry | undefined => readJsonCache<CacheEntry>(key, dir);

export function writeCache(key: string, output: BackendOutput, latencyMs: number, dir = CACHE_DIR): void {
	const entry: CacheEntry = { output, latencyMs, createdAt: new Date().toISOString() };
	writeJsonCache(key, entry, dir);
}
