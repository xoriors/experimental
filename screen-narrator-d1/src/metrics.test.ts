import { describe, expect, it } from "vitest";
import {
	auroc,
	binaryMetrics,
	brier,
	computeMetrics,
	costMetrics,
	ece,
	noiseMetrics,
	percentile,
	reliabilityBins,
	verdict,
} from "./metrics.ts";
import { DEFAULT_THRESHOLDS } from "./policy.ts";
import { kindAnswer, makePair, makeResult, makeRun, sampleRun } from "./report/fixtures.ts";
import { AMBIGUOUS as AMB, type Pair, type PairResult } from "./types.ts";

const s = (p: number, y: boolean) => ({ p, y });
const verdictsFor = (pairs: Pair[], results: PairResult[]) =>
	Object.fromEntries(pairs.map((p) => [p.id, verdict(p, results.find((r) => r.pairId === p.id), DEFAULT_THRESHOLDS)]));

describe("binary building blocks", () => {
	it("Brier is the mean squared error against 0/1", () => {
		// (0.9−1)² + (0.2−0)² + (0.6−0)² = 0.01 + 0.04 + 0.36 = 0.41 → /3
		expect(brier([s(0.9, true), s(0.2, false), s(0.6, false)])).toBeCloseTo(0.41 / 3, 10);
		expect(brier([])).toBeNull();
	});

	it("bins are equal-width, p = 1 lands in the last bin, empty bins are null", () => {
		const bins = reliabilityBins([s(0, false), s(0.05, true), s(0.95, true), s(1, true), s(0.5, false)]);
		expect(bins).toHaveLength(10);
		expect(bins[0]).toEqual({ lo: 0, hi: 0.1, n: 2, meanPred: 0.025, fracPositive: 0.5 });
		expect(bins[5]!.n).toBe(1);
		expect(bins[9]!.n).toBe(2);
		expect(bins[9]!.meanPred).toBeCloseTo(0.975, 10);
		expect(bins[3]).toEqual({ lo: 0.3, hi: 0.4, n: 0, meanPred: null, fracPositive: null });
	});

	it("ECE weights each bin's gap by its share of samples", () => {
		// bin 1: p 0.1,0.1 (mean 0.1), outcomes 0,1 (0.5) → gap 0.4, weight 2/4
		// bin 8: p 0.8,0.8 (mean 0.8), outcomes 1,1 (1.0) → gap 0.2, weight 2/4  ⇒ ECE = 0.3
		const bins = reliabilityBins([s(0.1, false), s(0.1, true), s(0.8, true), s(0.8, true)]);
		expect(ece(bins)).toBeCloseTo(0.3, 10);
		expect(ece(reliabilityBins([]))).toBeNull();
	});

	it("AUROC counts ties as half and is null when a class is missing", () => {
		// pos {0.8, 0.4}, neg {0.4, 0.2}: 0.8>0.4 1, 0.8>0.2 1, 0.4=0.4 0.5, 0.4>0.2 1 → 3.5 / 4
		expect(auroc([s(0.8, true), s(0.4, true), s(0.4, false), s(0.2, false)])).toBe(0.875);
		expect(auroc([s(0.3, true), s(0.6, false)])).toBe(0);
		expect(auroc([s(0.3, true), s(0.9, true)])).toBeNull();
	});

	it("thresholds inclusively, like decide()", () => {
		const m = binaryMetrics([s(0.5, true), s(0.49, false), s(0.7, false), s(0.1, true)], 0.5);
		// said: yes, no, yes, no → right, right, wrong, wrong
		expect(m.accuracy).toBe(0.5);
		expect(m.precision).toBe(0.5);
		expect(m.recall).toBe(0.5);
		expect(binaryMetrics([]).accuracy).toBeNull();
	});

	it("percentile is nearest-rank", () => {
		const xs = [50, 10, 40, 20, 30];
		expect(percentile(xs, 50)).toBe(30);
		expect(percentile(xs, 95)).toBe(50);
		expect(percentile([], 50)).toBeNull();
	});
});

describe("computeMetrics", () => {
	it("skips ambiguous labels per question but counts them", () => {
		const pairs = [
			makePair("a", { announce: true, kind: "dialog", urgency: 3 }),
			makePair("b", { announce: "ambiguous", kind: "ambiguous", urgency: 2 }),
			makePair("c", { announce: false, kind: "cosmetic", urgency: "ambiguous" }),
		];
		const pred = { announce: 0.9, kind: kindAnswer("dialog", 0.7), urgency: { score: 3, probabilities: {} } };
		const run = makeRun(pairs, pairs.map((p) => makeResult(p.id, "m", pred)));
		const m = computeMetrics(run);
		expect(m.ambiguous).toEqual({ announce: 1, kind: 1, urgency: 1 });
		const b = m.backends.m!;
		expect(b.announce.n).toBe(2);
		expect(b.announce.skippedAmbiguous).toBe(1);
		expect(b.announce.accuracy).toBe(0.5);
		expect(b.kind.n).toBe(2);
		expect(b.kind.accuracy).toBe(0.5);
		expect(b.kind.confusion[0]![0]).toBe(1); // dialog → dialog
		expect(b.kind.confusion[6]![0]).toBe(1); // cosmetic → dialog
		expect(b.kind.meanTrueProb).toBeCloseTo((0.7 + 0.3 / 7) / 2, 10);
		expect(b.urgency.n).toBe(2);
		expect(b.urgency.skippedAmbiguous).toBe(1);
	});

	it("skips errored results and fields a backend doesn't answer", () => {
		const pairs = [makePair("a"), makePair("b")];
		const run = makeRun(pairs, [
			makeResult("a", "pixel-diff", { announce: 1 }),
			makeResult("b", "pixel-diff", undefined, { error: "boom" }),
		]);
		const b = computeMetrics(run).backends["pixel-diff"]!;
		expect(b.announce.n).toBe(1);
		expect(b.kind.n).toBe(0);
		expect(b.kind.accuracy).toBeNull();
		expect(b.urgency.falseInterrupt).toEqual({ count: 0, of: 0, rate: null });
		expect(b.sensitive.n).toBe(0);
		expect(b.cost.errors).toBe(1);
	});

	it("pools supported: the true narration counts as a positive, the invented one as a negative", () => {
		const narrations = { supported: "x", unsupported: "y" };
		const pairs = [makePair("a", { narrations }), makePair("b", { narrations }), makePair("c")];
		const run = makeRun(pairs, [
			makeResult("a", "m", { supported: { supported: 0.9, unsupported: 0.2 } }),
			makeResult("b", "m", { supported: { supported: 0.4, unsupported: 0.6 } }),
			makeResult("c", "m", { supported: { supported: 0.9, unsupported: 0.1 } }), // no narrations label → ignored
		]);
		const sup = computeMetrics(run).backends.m!.supported;
		expect(sup.n).toBe(4);
		expect(sup.positives).toBe(2);
		expect(sup.accuracy).toBe(0.5); // 0.9 ✓, 0.2 ✓, 0.4 ✗, 0.6 ✗
		expect(sup.auroc).toBe(0.75); // pos {0.9, 0.4} vs neg {0.2, 0.6}: 1 + 1 + 1 + 0
	});

	it("counts false and missed interrupts against their own denominators", () => {
		const pairs = [
			makePair("calm1", { urgency: 1 }),
			makePair("calm2", { urgency: 0 }),
			makePair("calm3", { urgency: 2 }),
			makePair("urgent1", { urgency: 3 }),
			makePair("urgent2", { urgency: 3 }),
		];
		const score = { calm1: 2.6, calm2: 0.2, calm3: 2.4, urgent1: 2.4, urgent2: 3 } as Record<string, number>;
		const run = makeRun(pairs, pairs.map((p) => makeResult(p.id, "m", { urgency: { score: score[p.id]!, probabilities: {} } })));
		const u = computeMetrics(run).backends.m!.urgency;
		expect(u.falseInterrupt).toEqual({ count: 1, of: 3, rate: 1 / 3 }); // calm1 rounds to 3
		expect(u.missedInterrupt).toEqual({ count: 1, of: 2, rate: 0.5 }); // urgent1 rounds to 2
		expect(u.mae).toBeCloseTo((1.6 + 0.2 + 0.4 + 0.6 + 0) / 5, 10);
		expect(u.levelAccuracy).toBe(3 / 5); // calm2, calm3, urgent2
		expect(u.confusion[1]![3]).toBe(1);
	});

	it("flags confidently wrong answers in the verdicts", () => {
		const pairs = [makePair("a", { announce: false }), makePair("b", { announce: false }), makePair("c", { announce: true })];
		const run = makeRun(pairs, [
			makeResult("a", "m", { announce: 0.85 }),
			makeResult("b", "m", { announce: 0.6 }),
			makeResult("c", "m", { announce: 0.7, kind: kindAnswer("cosmetic", 0.9) }),
		]);
		const v = computeMetrics(run).verdicts;
		expect(v.a!.m).toMatchObject({ announce: false, wrong: true, confidentlyWrong: true, action: "queue" });
		expect(v.b!.m).toMatchObject({ announce: false, wrong: true, confidentlyWrong: false });
		expect(v.c!.m).toMatchObject({ announce: true, kind: false, wrong: true, confidentlyWrong: true });
	});

	it("counts the low tail's edge (p = 0.2) as confidently wrong, like p = 0.8", () => {
		const pairs = [makePair("low", { announce: true })];
		const v = computeMetrics(makeRun(pairs, [makeResult("low", "m", { announce: 0.2 })])).verdicts;
		expect(v.low!.m).toMatchObject({ announce: false, confidentlyWrong: true });
	});

	it("records the predicted level, whether anything was judged, and what the narrator said", () => {
		const pairs = [
			makePair("spoke", { announce: false, urgency: AMB }),
			makePair("quiet", { announce: true }),
			makePair("amb", { announce: AMB, kind: AMB, urgency: AMB }),
			makePair("err", { announce: true }),
		];
		const run = makeRun(pairs, [
			makeResult("spoke", "m", { announce: 0.9, urgency: { score: 2.6, probabilities: {} } }),
			makeResult("quiet", "m", { announce: 0.1 }),
			makeResult("amb", "m", { announce: 0.9 }),
			makeResult("err", "m", undefined, { error: "x" }),
		]);
		const v = computeMetrics(run).verdicts;
		// An ambiguous urgency label still gets the predicted level, it just isn't judged.
		expect(v.spoke!.m).toMatchObject({ level: 3, urgency: null, judged: true, action: "interrupt", said: true, saidWrongly: true });
		expect(v.quiet!.m).toMatchObject({ level: null, judged: true, said: false, saidWrongly: true });
		expect(v.amb!.m).toMatchObject({ judged: false, said: true, saidWrongly: false });
		expect(v.err!.m).toMatchObject({ judged: false, action: null, said: false, saidWrongly: true });
	});

	it("scores sensitive at the sensitive threshold, not 0.5", () => {
		const pairs = [makePair("a", { sensitive: true }), makePair("b", { sensitive: false })];
		const run = makeRun(pairs, [makeResult("a", "m", { sensitive: 0.4 }), makeResult("b", "m", { sensitive: 0.2 })]);
		expect(computeMetrics(run).backends.m!.sensitive.accuracy).toBe(0.5);
		const m = computeMetrics(run, { ...DEFAULT_THRESHOLDS, sensitive: 0.3 }).backends.m!.sensitive;
		expect(m).toMatchObject({ threshold: 0.3, accuracy: 1 });
	});
});

describe("noise", () => {
	it("counts announcements per minute over the session's span plus one step", () => {
		// 4 frames 15 s apart → 45 s + 15 s = 1 minute.
		const labels = [true, false, false, true] as const;
		const pairs = labels.map((announce, step) => makePair(`f${step}`, { announce }, { session: { name: "s", step, tMs: step * 15_000 } }));
		const pAnnounce = [0.9, 0.7, 0.1, 0.2];
		const results = pairs.map((p, i) => makeResult(p.id, "m", { announce: pAnnounce[i]! }));
		const n = noiseMetrics(pairs, verdictsFor(pairs, results));
		expect(n.sessions).toHaveLength(1);
		expect(n.sessions[0]).toEqual({
			name: "s",
			frames: 4,
			minutes: 1,
			predicted: 2,
			labelled: 2,
			predictedPerMin: 2,
			labelledPerMin: 2,
			falseAnnouncements: 1,
			missedAnnouncements: 1,
		});
		expect(n.total.predictedPerMin).toBe(2);
	});

	it("counts false and missed announcements exactly where the verdicts say saidWrongly", () => {
		const run = sampleRun();
		const m = computeMetrics(run);
		for (const backend of run.backends) {
			const session = m.backends[backend]!.noise.sessions[0]!;
			const wrongly = run.pairs.filter((p) => p.session && m.verdicts[p.id]![backend]!.saidWrongly).length;
			expect(session.falseAnnouncements + session.missedAnnouncements, backend).toBe(wrongly);
		}
	});

	it("treats urgency-0 answers and errors as silence, and has null rates without sessions", () => {
		const pairs = [0, 1].map((step) => makePair(`f${step}`, { announce: true }, { session: { name: "s", step, tMs: step * 30_000 } }));
		const results = [makeResult("f0", "m", { announce: 0.9, urgency: { score: 0.2, probabilities: {} } }), makeResult("f1", "m", undefined, { error: "x" })];
		expect(noiseMetrics(pairs, verdictsFor(pairs, results)).sessions[0]).toMatchObject({ predicted: 0, missedAnnouncements: 2, minutes: 1 });
		// A frame with no verdict at all is silence too.
		expect(noiseMetrics(pairs, {}).sessions[0]).toMatchObject({ predicted: 0, missedAnnouncements: 2 });
		const none = noiseMetrics([makePair("x")], {});
		expect(none.sessions).toEqual([]);
		expect(none.total.predictedPerMin).toBeNull();
	});
});

describe("cost", () => {
	it("is null-safe when prices are unknown", () => {
		const c = costMetrics([makeResult("a", "d1", { announce: 1 }, { inputTokens: 1000, costUsd: null }), makeResult("b", "d1", { announce: 1 }, { inputTokens: 3000 })]);
		expect(c.costUsd).toBeNull();
		expect(c.costPerPair).toBeNull();
		expect(c.tokensPerPair).toBe(2000);
	});

	it("averages cost over priced results and excludes errors from latency", () => {
		const c = costMetrics([
			makeResult("a", "m", {}, { costUsd: 0.002, latencyMs: 100, cached: true }),
			makeResult("b", "m", {}, { costUsd: 0.004, latencyMs: 300 }),
			makeResult("c", "m", {}, { costUsd: null, latencyMs: 200 }),
			makeResult("d", "m", undefined, { error: "x", latencyMs: 30_000 }),
		]);
		expect(c.costUsd).toBeCloseTo(0.006, 12);
		expect(c.costPerPair).toBeCloseTo(0.003, 12);
		expect(c.latencyP50).toBe(200);
		expect(c.latencyP95).toBe(300);
		expect(c).toMatchObject({ results: 4, errors: 1, cached: 1 });
	});
});

describe("sample run", () => {
	it("produces finite, JSON-safe metrics for every backend", () => {
		const run = sampleRun();
		const m = computeMetrics(run);
		expect(Object.keys(m.backends)).toEqual(run.backends);
		expect(JSON.stringify(m)).not.toMatch(/NaN|Infinity/);
		expect(m.backends["pixel-diff"]!.kind.n).toBe(0);
		expect(m.backends["d1-ultra"]!.announce.n).toBeGreaterThan(40);
		expect(m.sessions).toBe(1);
	});
});
