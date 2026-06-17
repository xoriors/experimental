import { scoreHour } from './activities';
import type { Activity, FusedHour, TripMode, Verdict } from './types';

type ResolvedMode = 'sea' | 'land';

const SEA_ACTIVITIES: Activity[] = ['ferryOrBoat', 'kayaking'];
const LAND_ACTIVITIES: Activity[] = ['sightseeing', 'hiking', 'photography'];

function clamp01(x: number): number {
	return Math.max(0, Math.min(1, x));
}

// linear factor: 1 at `best`, 0 at `worst`. `best` can be higher or lower than `worst`.
function tier(value: number, best: number, worst: number): number {
	if (best === worst) return value === best ? 1 : 0;
	return clamp01((value - worst) / (best - worst));
}

// blend the arithmetic mean of factors with their minimum so the worst factor
// pulls the score down more aggressively. This gives a wider score spread.
function blendMean(factors: number[]): number {
	const mean = factors.reduce((s, v) => s + v, 0) / factors.length;
	const min = Math.min(...factors);
	return mean * 0.6 + min * 0.4;
}

// continuous comfort score 1..100 for a sea trip starting in this hour
function seaContinuous(h: FusedHour): number {
	const wave = tier(h.waveHsM ?? 0.2, 0.2, 2.0);
	const wind = tier(h.windKn, 5, 22);
	const gust = tier(h.gustKn, 8, 28);
	const rain = tier(h.precipMmH, 0, 5);
	const vis = tier(h.visKm, 10, 1);
	const windFactor = (wind + gust) / 2;
	return Math.max(1, Math.round(blendMean([wave, windFactor, rain, vis]) * 100));
}

function landContinuous(h: FusedHour): number {
	const wind = tier(h.windKn, 5, 22);
	const gust = tier(h.gustKn, 8, 30);
	const rain = tier(h.precipMmH, 0, 5);
	const vis = tier(h.visKm, 10, 1);
	const tempC = h.tempC;
	const tempScore =
		tempC >= 16 && tempC <= 26
			? 1
			: tempC > 26
				? tier(tempC, 26, 36)
				: tier(tempC, 16, -2);
	const cloud = h.cloudPct;
	const cloudScore = cloud <= 70 ? 1 : tier(cloud, 70, 100);
	const windFactor = (wind + gust) / 2;
	return Math.max(1, Math.round(blendMean([windFactor, rain, vis, tempScore, cloudScore]) * 100));
}

export function hourTripScore(h: FusedHour, mode: ResolvedMode): number {
	const verdicts = scoreHour(h);
	const activities = mode === 'sea' ? SEA_ACTIVITIES : LAND_ACTIVITIES;
	// Any activity hitting 'unsafe' still vetoes the hour to 0 (clear danger).
	if (activities.some((a) => verdicts[a] === 'unsafe')) return 0;
	return mode === 'sea' ? seaContinuous(h) : landContinuous(h);
}

export type TripWindow = {
	startTime: string;
	startHour: number;
	durationH: number;
	hours: FusedHour[];
	score: number;
	avgScore: number;
};

export function findBestWindows(
	hours: FusedHour[],
	durationH: number,
	mode: ResolvedMode,
	minStartHour = 0,
	maxStartHour = 23,
	minStartTime?: string
): TripWindow[] {
	// Forecast data is hourly — round fractional durations up to the next
	// whole hour for slicing so a 1.5h trip still considers 2 hours of conditions.
	// Duration 0 means "right now" — score the current hour as a point reading.
	const sliceLen = Math.max(1, Math.ceil(durationH || 1));
	if (sliceLen < 1 || hours.length < sliceLen) return [];
	const windows: TripWindow[] = [];
	for (let i = 0; i + sliceLen <= hours.length; i++) {
		const slice = hours.slice(i, i + sliceLen);
		const match = /T(\d{2}):/.exec(slice[0].time);
		const startHour = match ? Number(match[1]) : 0;
		if (startHour < minStartHour || startHour > maxStartHour) continue;
		if (minStartTime && slice[0].time < minStartTime) continue;
		const scores = slice.map((h) => hourTripScore(h, mode));
		windows.push({
			startTime: slice[0].time,
			startHour,
			durationH,
			hours: slice,
			score: Math.min(...scores),
			avgScore: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
		});
	}
	return windows.sort((a, b) => b.score - a.score || b.avgScore - a.avgScore);
}

export function pickTopNonOverlapping(windows: TripWindow[], n: number): TripWindow[] {
	const picked: TripWindow[] = [];
	for (const w of windows) {
		const wStart = Date.parse(w.startTime + ':00Z');
		const wEnd = wStart + w.durationH * 3600_000;
		const overlaps = picked.some((p) => {
			const pStart = Date.parse(p.startTime + ':00Z');
			const pEnd = pStart + p.durationH * 3600_000;
			return wStart < pEnd && pStart < wEnd;
		});
		if (overlaps) continue;
		picked.push(w);
		if (picked.length >= n) break;
	}
	return picked;
}

export function windowScoreAt(
	allHours: FusedHour[],
	startIdx: number,
	durationH: number,
	mode: ResolvedMode
): number | null {
	const sliceLen = Math.max(1, Math.ceil(durationH || 1));
	if (startIdx < 0 || startIdx + sliceLen > allHours.length) return null;
	let min = 100;
	for (let i = startIdx; i < startIdx + sliceLen; i++) {
		const s = hourTripScore(allHours[i], mode);
		if (s < min) min = s;
	}
	return min;
}

export function detectMode(hours: FusedHour[]): ResolvedMode {
	if (hours.length === 0) return 'land';
	const marineHours = hours.filter((h) => h.waveHsM != null && h.waveHsM >= 0);
	return marineHours.length / hours.length >= 0.6 ? 'sea' : 'land';
}

export function hasMarineData(hours: FusedHour[]): boolean {
	if (hours.length === 0) return false;
	const marineHours = hours.filter((h) => h.waveHsM != null);
	return marineHours.length / hours.length >= 0.1;
}

/**
 * Pass-through now that auto mode is gone — the user explicitly picks
 * sea or land. Kept as a function so call sites don't have to import the
 * ResolvedMode alias separately, and so we can re-introduce per-day
 * fallbacks (e.g. land when no marine data exists) later without
 * touching all the call sites.
 */
export function resolveMode(mode: TripMode): ResolvedMode {
	return mode;
}

export function scoreToCss(score: number): { bg: string; border: string } {
	const clamped = Math.max(0, Math.min(100, score));
	const hue = (clamped / 100) * 120;
	return {
		bg: `hsla(${hue}, 65%, 35%, 0.18)`,
		border: `hsl(${hue}, 72%, 48%)`
	};
}
