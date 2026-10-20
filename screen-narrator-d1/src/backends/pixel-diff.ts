// The free baseline: "announce if more than T of the pixels changed". It answers only `announce`, and is expected
// to fail exactly where a decision model should shine: big cosmetic changes (hover on a large card) and small
// meaningful ones (a toast in a corner).
// - Decoding two PNGs and diffing them is ~40 ms of synchronous work per pair. It runs alongside the paid backends'
//   calls, so it yields to the event loop first (their timers and sockets would otherwise wait, inflating the
//   latency that gets cached with their answers), and the raw fraction is kept in runs/cache/pixel-diff so a re-run
//   doesn't redo it. T is applied after the cache, so changing PIXEL_DIFF_THRESHOLD recomputes nothing.
import path from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { Backend, BackendOutput } from "./types.ts";
import { CACHE_DIR, cacheKey, readJsonCache, sha256, writeJsonCache } from "../cache.ts";
import { parseDataUrl } from "../images.ts";

export const DEFAULT_PIXEL_DIFF_THRESHOLD = 0.005;
export const PIXEL_DIFF_CACHE_DIR = path.join(CACHE_DIR, "pixel-diff");

/** pixelmatch's per-pixel colour tolerance; part of the fraction cache key. */
const PIXELMATCH_OPTIONS = { threshold: 0.1, includeAA: false };

const pngBytes = (dataUrl: string): Buffer => {
	const img = parseDataUrl(dataUrl);
	if (!img) throw new Error("pixel-diff: an image is not a base64 data URL");
	return Buffer.from(img.data, "base64");
};

/** Fraction of pixels (0–1) that differ between two equally sized PNGs given as data URLs. */
export const changedFraction = (beforeUrl: string, afterUrl: string): number => changedFractionOf(pngBytes(beforeUrl), pngBytes(afterUrl));

function changedFractionOf(before: Buffer, after: Buffer): number {
	const a = PNG.sync.read(before);
	const b = PNG.sync.read(after);
	if (a.width !== b.width || a.height !== b.height)
		throw new Error(`pixel-diff needs equal sizes, got ${a.width}×${a.height} vs ${b.width}×${b.height}`);
	const diff = pixelmatch(a.data, b.data, undefined, a.width, a.height, PIXELMATCH_OPTIONS);
	return diff / (a.width * a.height);
}

/** changedFraction through the on-disk cache (null `dir` = no cache), yielding to the event loop before computing. */
export async function cachedChangedFraction(beforeUrl: string, afterUrl: string, dir: string | null): Promise<number> {
	// Decoded once: both the cache key and the diff use these bytes.
	const before = pngBytes(beforeUrl);
	const after = pngBytes(afterUrl);
	const compute = async () => {
		await yieldToEventLoop();
		return changedFractionOf(before, after);
	};
	if (dir === null) return compute();
	const key = cacheKey({
		fingerprint: `pixel-diff:fraction:${JSON.stringify(PIXELMATCH_OPTIONS)}`,
		state: null,
		questions: null,
		beforeSha: sha256(before),
		afterSha: sha256(after),
	});
	const hit = readJsonCache<{ fraction: number }>(key, dir);
	if (typeof hit?.fraction === "number") return hit.fraction;
	const fraction = await compute();
	writeJsonCache(key, { fraction }, dir);
	return fraction;
}

/**
 * Map a changed fraction onto [0, 1] so that p = 0.5 exactly at the threshold T and saturates at 2T.
 * This is a monotone score, not a calibrated probability: it only lets the report put pixel diff on the same axes
 * (accuracy at 0.5, reliability diagram) as the models, and its "calibration" there is expected to be poor.
 */
export const announceScore = (fraction: number, threshold: number): number => Math.min(1, Math.max(0, fraction / (2 * threshold)));

function thresholdFromEnv(): number {
	const raw = process.env.PIXEL_DIFF_THRESHOLD?.trim();
	if (!raw) return DEFAULT_PIXEL_DIFF_THRESHOLD;
	const t = Number(raw);
	if (!Number.isFinite(t) || t <= 0 || t > 0.5) throw new Error(`PIXEL_DIFF_THRESHOLD must be a fraction in (0, 0.5], got "${raw}"`);
	return t;
}

/** `cacheDir: null` turns the fraction cache off (tests). */
export function pixelDiffBackend(threshold = thresholdFromEnv(), cacheDir: string | null = PIXEL_DIFF_CACHE_DIR): Backend {
	return {
		name: "pixel-diff",
		// Its answers stay out of the paid-answer cache: only the fraction is cached, so the threshold applies fresh.
		cacheable: false,
		fingerprint: `pixel-diff:T=${threshold}`,
		async answer({ images }): Promise<BackendOutput> {
			const fraction = await cachedChangedFraction(images[0], images[1], cacheDir);
			return { prediction: { announce: announceScore(fraction, threshold) }, inputTokens: 0, outputTokens: 0, costUsd: 0 };
		},
		estimate: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
	};
}
