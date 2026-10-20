// Scores a RunResult: how often each backend is right, how well its probabilities are calibrated, how noisy it would
// be as a narrator, and what it costs. Pure functions over the shapes in types.ts, so tests can hand-check the maths.
//
// Shape of `computeMetrics(run)` (every "no data" value is an explicit null, never NaN or undefined, so it survives
// JSON.stringify unchanged):
//
//   RunMetrics {
//     thresholds                    the policy thresholds used (announce and sensitive scoring, decide())
//     pairs, ambiguous{announce,kind,urgency}, sessions   counts over the whole run
//     backends: { [name]: BackendMetrics }   in run.backends order
//     verdicts: { [pairId]: { [backend]: Verdict } }      per-pair right/wrong, for the report's pair browser
//   }
//   BackendMetrics { announce, sensitive, supported: BinaryMetrics; kind: KindMetrics; urgency: UrgencyMetrics;
//                    primary: PrimaryMetrics; noise: NoiseMetrics; cost: CostMetrics }
//
// A result is skipped for a question when it has an `error` or the prediction lacks that field (pixel diff only
// answers `announce`); a pair is skipped for a question when its label is AMBIGUOUS (counted in `skippedAmbiguous`).
import { type Action, decide, DEFAULT_THRESHOLDS, type Thresholds, urgencyLevel } from "./policy.ts";
import { AMBIGUOUS, CHANGE_KINDS, type ChangeKind, type Pair, type PairResult, type Prediction, type RunResult, type Urgency } from "./types.ts";

export const BIN_COUNT = 10;
/** Confidently wrong = wrong while P(announce) was at least this far into either tail, or kind wrong at this confidence. */
export const CONFIDENT = 0.8;

export interface ReliabilityBin {
	lo: number;
	hi: number;
	n: number;
	/** Mean predicted probability of the bin's samples. */
	meanPred: number | null;
	/** Fraction of the bin's samples whose outcome was true. */
	fracPositive: number | null;
}

export interface BinaryMetrics {
	n: number;
	skippedAmbiguous: number;
	positives: number;
	threshold: number;
	accuracy: number | null;
	precision: number | null;
	recall: number | null;
	brier: number | null;
	ece: number | null;
	auroc: number | null;
	bins: ReliabilityBin[];
}

export interface KindMetrics {
	n: number;
	skippedAmbiguous: number;
	accuracy: number | null;
	/** Mean probability the backend gave the labelled kind. */
	meanTrueProb: number | null;
	/** confusion[label][predicted], both indexed like `labels` (CHANGE_KINDS). */
	labels: ChangeKind[];
	confusion: number[][];
	/** Calibration of the top-1 probability against "top-1 was right". */
	confidence: BinaryMetrics;
}

export interface RateCount {
	count: number;
	of: number;
	rate: number | null;
}

export interface UrgencyMetrics {
	n: number;
	skippedAmbiguous: number;
	/** Mean |score − label|, score being the expected level (0–3). */
	mae: number | null;
	/** urgencyLevel(score) === label. */
	levelAccuracy: number | null;
	/** Predicted level 3 when the label is below 3: interrupting for nothing, the worst mistake for a screen reader user. */
	falseInterrupt: RateCount;
	/** Label 3, predicted below 3. */
	missedInterrupt: RateCount;
	/** confusion[label][predicted level], 4×4. */
	confusion: number[][];
}

export interface PrimaryMetrics {
	n: number;
	accuracy: number | null;
}

export interface SessionNoise {
	name: string;
	frames: number;
	/** (max tMs − min tMs + median step gap) in minutes; null below 2 frames. */
	minutes: number | null;
	/** Frames where decide() would not drop. Errored or missing results count as silence. */
	predicted: number;
	/** Frames labelled announce = true. */
	labelled: number;
	predictedPerMin: number | null;
	labelledPerMin: number | null;
	/** Announced but labelled false (ambiguous labels excluded). */
	falseAnnouncements: number;
	/** Labelled true but not announced. */
	missedAnnouncements: number;
}

export interface NoiseMetrics {
	sessions: SessionNoise[];
	/** Totals over all sessions; per-minute values null when the run has no sessions. */
	total: Omit<SessionNoise, "name">;
}

export interface CostMetrics {
	results: number;
	errors: number;
	cached: number;
	/** Nearest-rank percentiles over results without an error. */
	latencyP50: number | null;
	latencyP95: number | null;
	inputTokens: number;
	outputTokens: number;
	/** (input + output) / results that reported tokens. */
	tokensPerPair: number | null;
	/** Sum of numeric costUsd; null when no result has a known price. */
	costUsd: number | null;
	/** costUsd / results with a numeric cost. */
	costPerPair: number | null;
	/** Results with a numeric cost; below `results − errors` means costUsd is a partial sum. */
	priced: number;
}

export interface BackendMetrics {
	announce: BinaryMetrics;
	sensitive: BinaryMetrics;
	supported: BinaryMetrics;
	kind: KindMetrics;
	urgency: UrgencyMetrics;
	primary: PrimaryMetrics;
	noise: NoiseMetrics;
	cost: CostMetrics;
}

/** Per pair and backend: null = not judged (ambiguous label, unanswered field, or error). */
export interface Verdict {
	announce: boolean | null;
	kind: boolean | null;
	urgency: boolean | null;
	/** The predicted urgency level (urgencyLevel of the score); null when urgency wasn't answered. */
	level: Urgency | null;
	/** Predicted level 3 where the label is below 3. */
	falseInterrupt: boolean;
	/** At least one of announce / kind / urgency was judged. */
	judged: boolean;
	/** Any judged answer wrong. */
	wrong: boolean;
	confidentlyWrong: boolean;
	/** What the narrator would do with this answer (decide()); null on error. */
	action: Action | null;
	speech: string | null;
	/** The narrator would speak (action is not drop). Errored or missing results are silence. */
	said: boolean;
	/** `said` disagrees with a clear announce label: a false or a missed announcement. False for ambiguous labels. */
	saidWrongly: boolean;
}

export interface RunMetrics {
	thresholds: Thresholds;
	pairs: number;
	ambiguous: { announce: number; kind: number; urgency: number };
	sessions: number;
	backends: Record<string, BackendMetrics>;
	verdicts: Record<string, Record<string, Verdict>>;
}

// --- building blocks ---------------------------------------------------------------------------------------------

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);
type Sample = { p: number; y: boolean };
const sample = (p: number, y: boolean): Sample => ({ p, y });

export function brier(samples: Sample[]): number | null {
	return mean(samples.map(({ p, y }) => (p - (y ? 1 : 0)) ** 2));
}

/** Equal-width bins over [0, 1]; p = 1 falls in the last bin. All bins are returned, empty ones with nulls. */
export function reliabilityBins(samples: Sample[], count = BIN_COUNT): ReliabilityBin[] {
	const groups: Sample[][] = Array.from({ length: count }, () => []);
	for (const s of samples) groups[Math.min(count - 1, Math.max(0, Math.floor(s.p * count)))]!.push(s);
	return groups.map((g, i) => ({
		lo: i / count,
		hi: (i + 1) / count,
		n: g.length,
		meanPred: mean(g.map((s) => s.p)),
		fracPositive: mean(g.map((s) => (s.y ? 1 : 0))),
	}));
}

/** Expected calibration error: Σ (n_bin / N) · |meanPred − fracPositive|. */
export function ece(bins: ReliabilityBin[]): number | null {
	const total = bins.reduce((a, b) => a + b.n, 0);
	if (!total) return null;
	return bins.reduce((acc, b) => (b.n ? acc + (b.n / total) * Math.abs(b.meanPred! - b.fracPositive!) : acc), 0);
}

/** P(a random positive scores above a random negative), ties counting half. Null when a class is missing. */
export function auroc(samples: Sample[]): number | null {
	const pos = samples.filter((s) => s.y).map((s) => s.p);
	const neg = samples.filter((s) => !s.y).map((s) => s.p);
	if (!pos.length || !neg.length) return null;
	let wins = 0;
	for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
	return wins / (pos.length * neg.length);
}

export function binaryMetrics(samples: Sample[], threshold = 0.5, skippedAmbiguous = 0): BinaryMetrics {
	let tp = 0;
	let fp = 0;
	let fn = 0;
	let correct = 0;
	for (const { p, y } of samples) {
		const said = p >= threshold;
		if (said === y) correct++;
		if (said && y) tp++;
		if (said && !y) fp++;
		if (!said && y) fn++;
	}
	const bins = reliabilityBins(samples);
	return {
		n: samples.length,
		skippedAmbiguous,
		positives: samples.filter((s) => s.y).length,
		threshold,
		accuracy: ratio(correct, samples.length),
		precision: ratio(tp, tp + fp),
		recall: ratio(tp, tp + fn),
		brier: brier(samples),
		ece: ece(bins),
		auroc: auroc(samples),
		bins,
	};
}

/** Nearest-rank percentile (q in 0–100) of an unsorted list. */
export function percentile(xs: number[], q: number): number | null {
	if (!xs.length) return null;
	const sorted = [...xs].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil((q / 100) * sorted.length) - 1)]!;
}

/** The top-1 kind and its probability (the `choice`'s own probability, else the largest one). */
export function topKind(k: NonNullable<Prediction["kind"]>): { choice: ChangeKind; p: number } {
	const own = k.probabilities[k.choice];
	if (own !== undefined) return { choice: k.choice, p: own };
	const best = Math.max(0, ...Object.values(k.probabilities).filter((v): v is number => typeof v === "number"));
	return { choice: k.choice, p: best };
}

// --- per-question metrics ----------------------------------------------------------------------------------------

/** Results for one backend that answered, joined with their pair. */
type Answered = { pair: Pair; result: PairResult & { prediction: NonNullable<PairResult["prediction"]> } };

function answered(pairs: Map<string, Pair>, results: PairResult[]): Answered[] {
	const out: Answered[] = [];
	for (const result of results) {
		const pair = pairs.get(result.pairId);
		if (pair && result.prediction && !result.error) out.push({ pair, result: result as Answered["result"] });
	}
	return out;
}

export function announceMetrics(rows: Answered[], threshold: number): BinaryMetrics {
	const samples: Sample[] = [];
	let skipped = 0;
	for (const { pair, result } of rows) {
		const p = result.prediction.announce;
		if (p === undefined) continue;
		const label = pair.labels.announce;
		if (label === AMBIGUOUS) skipped++;
		else samples.push(sample(p, label));
	}
	return binaryMetrics(samples, threshold, skipped);
}

export function sensitiveMetrics(rows: Answered[], threshold: number): BinaryMetrics {
	const samples: Sample[] = [];
	for (const { pair, result } of rows)
		if (result.prediction.sensitive !== undefined) samples.push(sample(result.prediction.sensitive, pair.labels.sensitive));
	return binaryMetrics(samples, threshold);
}

/** Pools both narrations: P(supported) for the true one should be high, for the invented one low. */
export function supportedMetrics(rows: Answered[]): BinaryMetrics {
	const samples: Sample[] = [];
	for (const { pair, result } of rows) {
		const s = result.prediction.supported;
		if (!s || !pair.labels.narrations) continue;
		samples.push(sample(s.supported, true), sample(s.unsupported, false));
	}
	return binaryMetrics(samples);
}

export function kindMetrics(rows: Answered[]): KindMetrics {
	const labels = [...CHANGE_KINDS];
	const confusion = labels.map(() => labels.map(() => 0));
	const confidence: Sample[] = [];
	const trueProbs: number[] = [];
	let skipped = 0;
	for (const { pair, result } of rows) {
		const k = result.prediction.kind;
		if (!k) continue;
		const label = pair.labels.kind;
		if (label === AMBIGUOUS) {
			skipped++;
			continue;
		}
		const top = topKind(k);
		const row = labels.indexOf(label);
		const col = labels.indexOf(top.choice);
		if (row >= 0 && col >= 0) confusion[row]![col]!++;
		confidence.push(sample(top.p, top.choice === label));
		trueProbs.push(k.probabilities[label] ?? 0);
	}
	const conf = binaryMetrics(confidence);
	return { n: confidence.length, skippedAmbiguous: skipped, accuracy: conf.n ? conf.positives / conf.n : null, meanTrueProb: mean(trueProbs), labels, confusion, confidence: conf };
}

export function urgencyMetrics(rows: Answered[]): UrgencyMetrics {
	const errors: number[] = [];
	const confusion = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
	let exact = 0;
	let skipped = 0;
	const fi = { count: 0, of: 0 };
	const mi = { count: 0, of: 0 };
	for (const { pair, result } of rows) {
		const u = result.prediction.urgency;
		if (!u) continue;
		const label = pair.labels.urgency;
		if (label === AMBIGUOUS) {
			skipped++;
			continue;
		}
		const level = urgencyLevel(u.score);
		// A non-number score counts as 0, as urgencyLevel treats it, so the MAE never turns into NaN.
		errors.push(Math.abs((Number.isFinite(u.score) ? u.score : 0) - label));
		confusion[label]![level]!++;
		if (level === label) exact++;
		if (label < 3) {
			fi.of++;
			if (level === 3) fi.count++;
		} else {
			mi.of++;
			if (level < 3) mi.count++;
		}
	}
	return {
		n: errors.length,
		skippedAmbiguous: skipped,
		mae: mean(errors),
		levelAccuracy: ratio(exact, errors.length),
		falseInterrupt: { ...fi, rate: ratio(fi.count, fi.of) },
		missedInterrupt: { ...mi, rate: ratio(mi.count, mi.of) },
		confusion,
	};
}

export function primaryMetrics(rows: Answered[]): PrimaryMetrics {
	let n = 0;
	let correct = 0;
	for (const { pair, result } of rows) {
		const p = result.prediction.primary;
		if (!p || !pair.labels.primary) continue;
		n++;
		if (p.choice === pair.labels.primary.answer) correct++;
	}
	return { n, accuracy: ratio(correct, n) };
}

/** Median gap between consecutive frames, used as the length of the last frame. */
function stepGap(times: number[]): number | null {
	const gaps = times.slice(1).map((t, i) => t - times[i]!);
	if (!gaps.length) return null;
	const sorted = gaps.sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Counts what a narrator would have said over every scripted session, from the same verdicts the report's session
 * strip draws (`verdicts[pairId]`, one backend's). A frame without a verdict counts as silence.
 */
export function noiseMetrics(pairs: Pair[], verdicts: Record<string, Verdict | undefined>): NoiseMetrics {
	const groups = new Map<string, Pair[]>();
	for (const p of pairs) {
		if (!p.session) continue;
		let group = groups.get(p.session.name);
		if (!group) groups.set(p.session.name, (group = []));
		group.push(p);
	}

	const sessions: SessionNoise[] = [];
	for (const [name, frames] of groups) {
		frames.sort((a, b) => a.session!.tMs - b.session!.tMs || a.session!.step - b.session!.step);
		const times = frames.map((f) => f.session!.tMs);
		const gap = stepGap(times);
		const minutes = gap === null ? null : (times.at(-1)! - times[0]! + gap) / 60_000;
		let predicted = 0;
		let labelled = 0;
		let falseA = 0;
		let missed = 0;
		for (const f of frames) {
			const v = verdicts[f.id];
			const said = v?.said ?? false;
			const wrongly = v?.saidWrongly ?? f.labels.announce === true;
			if (said) predicted++;
			if (f.labels.announce === true) labelled++;
			if (wrongly && said) falseA++;
			if (wrongly && !said) missed++;
		}
		sessions.push({
			name,
			frames: frames.length,
			minutes,
			predicted,
			labelled,
			predictedPerMin: minutes ? predicted / minutes : null,
			labelledPerMin: minutes ? labelled / minutes : null,
			falseAnnouncements: falseA,
			missedAnnouncements: missed,
		});
	}

	const sum = (list: SessionNoise[], f: (s: SessionNoise) => number) => list.reduce((a, s) => a + f(s), 0);
	// Per-minute totals only over sessions that have a duration.
	const timed = sessions.filter((s) => s.minutes);
	const minutes = timed.length ? sum(timed, (s) => s.minutes!) : null;
	return {
		sessions,
		total: {
			frames: sum(sessions, (s) => s.frames),
			minutes,
			predicted: sum(sessions, (s) => s.predicted),
			labelled: sum(sessions, (s) => s.labelled),
			predictedPerMin: minutes ? sum(timed, (s) => s.predicted) / minutes : null,
			labelledPerMin: minutes ? sum(timed, (s) => s.labelled) / minutes : null,
			falseAnnouncements: sum(sessions, (s) => s.falseAnnouncements),
			missedAnnouncements: sum(sessions, (s) => s.missedAnnouncements),
		},
	};
}

export function costMetrics(results: PairResult[]): CostMetrics {
	const ok = results.filter((r) => !r.error);
	const latencies = ok.map((r) => r.latencyMs).filter((v) => Number.isFinite(v));
	const withTokens = results.filter((r) => r.inputTokens !== undefined || r.outputTokens !== undefined);
	const inputTokens = results.reduce((a, r) => a + (r.inputTokens ?? 0), 0);
	const outputTokens = results.reduce((a, r) => a + (r.outputTokens ?? 0), 0);
	const priced = results.filter((r) => typeof r.costUsd === "number");
	const costUsd = priced.length ? priced.reduce((a, r) => a + (r.costUsd as number), 0) : null;
	return {
		results: results.length,
		errors: results.length - ok.length,
		cached: results.filter((r) => r.cached).length,
		latencyP50: percentile(latencies, 50),
		latencyP95: percentile(latencies, 95),
		inputTokens,
		outputTokens,
		tokensPerPair: ratio(inputTokens + outputTokens, withTokens.length),
		costUsd,
		costPerPair: costUsd === null ? null : costUsd / priced.length,
		priced: priced.length,
	};
}

/** Right/wrong per question for one answer; what the pair browser filters on. */
export function verdict(pair: Pair, result: PairResult | undefined, thresholds: Thresholds): Verdict {
	const { labels } = pair;
	const v: Verdict = {
		announce: null,
		kind: null,
		urgency: null,
		level: null,
		falseInterrupt: false,
		judged: false,
		wrong: false,
		confidentlyWrong: false,
		action: null,
		speech: null,
		said: false,
		saidWrongly: labels.announce === true,
	};
	const p = result && !result.error ? result.prediction : undefined;
	if (!p) return v;
	if (p.announce !== undefined && labels.announce !== AMBIGUOUS) {
		v.announce = p.announce >= thresholds.announce === labels.announce;
		// Not `p <= 1 - CONFIDENT`: 1 - 0.8 is 0.19999999999999996, which would leave p = 0.2 out of the low tail.
		if (!v.announce && Math.max(p.announce, 1 - p.announce) >= CONFIDENT) v.confidentlyWrong = true;
	}
	if (p.kind && labels.kind !== AMBIGUOUS) {
		const top = topKind(p.kind);
		v.kind = top.choice === labels.kind;
		if (!v.kind && top.p >= CONFIDENT) v.confidentlyWrong = true;
	}
	if (p.urgency) {
		v.level = urgencyLevel(p.urgency.score);
		if (labels.urgency !== AMBIGUOUS) {
			v.urgency = v.level === labels.urgency;
			v.falseInterrupt = v.level === 3 && labels.urgency < 3;
		}
	}
	v.judged = v.announce !== null || v.kind !== null || v.urgency !== null;
	v.wrong = v.announce === false || v.kind === false || v.urgency === false;
	const d = decide(p, thresholds);
	v.action = d.action;
	v.speech = d.speech;
	v.said = d.action !== "drop";
	v.saidWrongly = labels.announce !== AMBIGUOUS && v.said !== labels.announce;
	return v;
}

// --- the whole run -----------------------------------------------------------------------------------------------

export function computeMetrics(run: RunResult, thresholds: Thresholds = DEFAULT_THRESHOLDS): RunMetrics {
	const pairs = new Map(run.pairs.map((p) => [p.id, p]));
	const backends: Record<string, BackendMetrics> = {};
	const verdicts: RunMetrics["verdicts"] = Object.fromEntries(run.pairs.map((p) => [p.id, {}]));

	for (const backend of run.backends) {
		const results = run.results.filter((r) => r.backend === backend);
		const rows = answered(pairs, results);
		const byPair = new Map(results.map((r) => [r.pairId, r]));
		const mine: Record<string, Verdict> = {};
		for (const pair of run.pairs) mine[pair.id] = verdicts[pair.id]![backend] = verdict(pair, byPair.get(pair.id), thresholds);
		backends[backend] = {
			announce: announceMetrics(rows, thresholds.announce),
			sensitive: sensitiveMetrics(rows, thresholds.sensitive),
			supported: supportedMetrics(rows),
			kind: kindMetrics(rows),
			urgency: urgencyMetrics(rows),
			primary: primaryMetrics(rows),
			noise: noiseMetrics(run.pairs, mine),
			cost: costMetrics(results),
		};
	}

	return {
		thresholds,
		pairs: run.pairs.length,
		ambiguous: {
			announce: run.pairs.filter((p) => p.labels.announce === AMBIGUOUS).length,
			kind: run.pairs.filter((p) => p.labels.kind === AMBIGUOUS).length,
			urgency: run.pairs.filter((p) => p.labels.urgency === AMBIGUOUS).length,
		},
		sessions: new Set(run.pairs.flatMap((p) => (p.session ? [p.session.name] : []))).size,
		backends,
		verdicts,
	};
}
