import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";
import { announceScore, cachedChangedFraction, changedFraction, DEFAULT_PIXEL_DIFF_THRESHOLD, pixelDiffBackend } from "./pixel-diff.ts";
import { fromRoot } from "../env.ts";
import type { Pair } from "../types.ts";

// Scratch cache dir under runs/ (gitignored), like cache.test.ts.
mkdirSync(fromRoot("runs"), { recursive: true });
const tmp = mkdtempSync(fromRoot("runs", ".pixel-diff-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A w×h light-grey PNG data URL with the first `dark` pixels (row-major) black. */
function png(w: number, h: number, dark = 0): string {
	const p = new PNG({ width: w, height: h });
	for (let i = 0; i < w * h; i++) {
		const v = i < dark ? 0 : 240;
		p.data.set([v, v, v, 255], i * 4);
	}
	return `data:image/png;base64,${PNG.sync.write(p).toString("base64")}`;
}

describe("announceScore", () => {
	it("is 0 for no change, 0.5 at the threshold and saturates at 1 from twice the threshold", () => {
		expect(announceScore(0, 0.005)).toBe(0);
		expect(announceScore(0.005, 0.005)).toBe(0.5);
		expect(announceScore(0.0025, 0.005)).toBe(0.25);
		expect(announceScore(0.01, 0.005)).toBe(1);
		expect(announceScore(0.9, 0.005)).toBe(1);
	});
});

describe("changedFraction", () => {
	it("is 0 for identical images and counts changed pixels otherwise", () => {
		expect(changedFraction(png(20, 10), png(20, 10))).toBe(0);
		expect(changedFraction(png(20, 10), png(20, 10, 50))).toBe(0.25);
	});

	it("refuses images of different sizes and non-data URLs", () => {
		expect(() => changedFraction(png(20, 10), png(10, 20))).toThrow(/equal sizes/);
		expect(() => changedFraction("before.png", png(20, 10))).toThrow(/data URL/);
	});
});

describe("cachedChangedFraction", () => {
	it("stores the raw fraction once and serves it from disk after that", async () => {
		const dir = path.join(tmp, "fractions");
		const [a, b] = [png(20, 10), png(20, 10, 50)];
		expect(await cachedChangedFraction(a, b, dir)).toBe(0.25);
		const files = readdirSync(dir);
		expect(files).toHaveLength(1);
		expect(JSON.parse(readFileSync(path.join(dir, files[0]!), "utf8"))).toEqual({ fraction: 0.25 });
		// Proof it's read, not recomputed: a doctored entry wins.
		writeFileSync(path.join(dir, files[0]!), JSON.stringify({ fraction: 0.125 }));
		expect(await cachedChangedFraction(a, b, dir)).toBe(0.125);
		// Swapping the images is a different key.
		expect(await cachedChangedFraction(b, a, dir)).toBe(0.25);
		expect(readdirSync(dir)).toHaveLength(2);
	});

	it("computes without touching disk when the cache is off", async () => {
		expect(await cachedChangedFraction(png(20, 10), png(20, 10, 50), null)).toBe(0.25);
	});
});

describe("pixelDiffBackend", () => {
	const pair = {} as Pair;

	it("answers only announce, for free, with T in the fingerprint", async () => {
		const b = pixelDiffBackend(undefined, null);
		expect(b.cacheable).toBe(false);
		expect(b.fingerprint).toBe(`pixel-diff:T=${DEFAULT_PIXEL_DIFF_THRESHOLD}`);
		// 1 changed pixel of 200 = 0.005 = exactly the default threshold.
		const out = await b.answer({ pair, questionSet: "all", images: [png(20, 10), png(20, 10, 1)] });
		expect(out.prediction).toEqual({ announce: 0.5 });
		expect(out.costUsd).toBe(0);
		expect(b.estimate!(pair, "all")).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
	});

	it("applies the threshold after the fraction cache, so a new T needs no recompute", async () => {
		const dir = path.join(tmp, "thresholds");
		const images: [string, string] = [png(20, 10), png(20, 10, 1)];
		expect((await pixelDiffBackend(0.005, dir).answer({ pair, questionSet: "all", images })).prediction).toEqual({ announce: 0.5 });
		expect((await pixelDiffBackend(0.01, dir).answer({ pair, questionSet: "all", images })).prediction).toEqual({ announce: 0.25 });
		expect(readdirSync(dir)).toHaveLength(1);
	});

	it("takes the threshold from PIXEL_DIFF_THRESHOLD and rejects nonsense", () => {
		const old = process.env.PIXEL_DIFF_THRESHOLD;
		try {
			process.env.PIXEL_DIFF_THRESHOLD = "0.02";
			expect(pixelDiffBackend().fingerprint).toBe("pixel-diff:T=0.02");
			process.env.PIXEL_DIFF_THRESHOLD = "five";
			expect(() => pixelDiffBackend()).toThrow(/PIXEL_DIFF_THRESHOLD/);
		} finally {
			if (old === undefined) delete process.env.PIXEL_DIFF_THRESHOLD;
			else process.env.PIXEL_DIFF_THRESHOLD = old;
		}
	});
});
