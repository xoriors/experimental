import { scoreHour } from './activities';
import type { Activity, FusedHour, TripMode, Verdict } from './types';

const SCORE: Record<Verdict, number> = { unsafe: 0, poor: 35, ok: 65, good: 95 };

type ResolvedMode = 'sea' | 'land';

const SEA_ACTIVITIES: Activity[] = ['ferryOrBoat', 'kayaking'];
const LAND_ACTIVITIES: Activity[] = ['sightseeing', 'hiking', 'photography'];

export function hourTripScore(h: FusedHour, mode: ResolvedMode): number {
	const verdicts = scoreHour(h);
	const activities = mode === 'sea' ? SEA_ACTIVITIES : LAND_ACTIVITIES;
	const nums = activities.map((a) => SCORE[verdicts[a]]);
	if (Math.min(...nums) === SCORE.unsafe) return 0;
	const sum = nums.reduce((s, v) => s + v, 0);
	return Math.round(sum / nums.length);
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
	maxStartHour = 23
): TripWindow[] {
	if (durationH < 1 || hours.length < durationH) return [];
	const windows: TripWindow[] = [];
	for (let i = 0; i + durationH <= hours.length; i++) {
		const slice = hours.slice(i, i + durationH);
		const match = /T(\d{2}):/.exec(slice[0].time);
		const startHour = match ? Number(match[1]) : 0;
		if (startHour < minStartHour || startHour > maxStartHour) continue;
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

export function windowScoreAt(
	allHours: FusedHour[],
	startIdx: number,
	durationH: number,
	mode: ResolvedMode
): number | null {
	if (startIdx < 0 || startIdx + durationH > allHours.length) return null;
	let min = 100;
	for (let i = startIdx; i < startIdx + durationH; i++) {
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

export function resolveMode(mode: TripMode, hours: FusedHour[]): ResolvedMode {
	if (mode === 'sea') {
		if (!hasMarineData(hours)) return 'land';
		return 'sea';
	}
	if (mode === 'land') return 'land';
	return detectMode(hours);
}

export function scoreToCss(score: number): { bg: string; border: string } {
	const clamped = Math.max(0, Math.min(100, score));
	const hue = (clamped / 100) * 120;
	return {
		bg: `hsla(${hue}, 65%, 35%, 0.18)`,
		border: `hsl(${hue}, 72%, 48%)`
	};
}
