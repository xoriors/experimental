import { describe, it, expect } from 'vitest';
import { detectMode, findBestWindows, hourTripScore, resolveMode, scoreToCss } from '../src/lib/trip-score';
import type { FusedHour } from '../src/lib/types';

function mk(time: string, override: Partial<FusedHour> = {}): FusedHour {
	return {
		time,
		tempC: 25,
		apparentC: 26,
		precipMmH: 0,
		rainMmH: 0,
		showersMmH: 0,
		pop: 0,
		weatherCode: 0,
		cloudPct: 30,
		visKm: 15,
		windKn: 5,
		gustKn: 8,
		windDirDeg: 0,
		humidityPct: 70,
		pressureHpa: 1010,
		uv: 5,
		waveHsM: 0.3,
		wavePeriodS: 5,
		swellHsM: 0.2,
		...override
	};
}

describe('hourTripScore', () => {
	it('calm sea conditions → high sea score', () => {
		const s = hourTripScore(mk('2026-05-21T09:00', { waveHsM: 0.4, gustKn: 12 }), 'sea');
		expect(s).toBeGreaterThanOrEqual(80);
	});

	it('big waves → sea score = 0 (unsafe veto)', () => {
		const s = hourTripScore(mk('2026-05-21T14:00', { waveHsM: 3, gustKn: 40 }), 'sea');
		expect(s).toBe(0);
	});

	it('dry temperate land hour → high land score', () => {
		const s = hourTripScore(mk('2026-05-21T12:00', { precipMmH: 0, windKn: 6, visKm: 15, cloudPct: 30 }), 'land');
		expect(s).toBeGreaterThanOrEqual(80);
	});

	it('heavy storm → land score = 0 (sightseeing unsafe)', () => {
		const s = hourTripScore(mk('2026-05-21T14:00', { precipMmH: 8, gustKn: 40 }), 'land');
		expect(s).toBe(0);
	});

	it('sea mode ignores land-only verdicts', () => {
		const seaScore = hourTripScore(mk('2026-05-21T12:00', { waveHsM: 0.3, gustKn: 10, precipMmH: 0 }), 'sea');
		const landScore = hourTripScore(mk('2026-05-21T12:00', { waveHsM: 0.3, gustKn: 10, precipMmH: 0 }), 'land');
		expect(seaScore).toBeGreaterThanOrEqual(80);
		expect(landScore).toBeGreaterThanOrEqual(80);
	});
});

describe('findBestWindows', () => {
	it('returns windows sorted by min-hour score', () => {
		const hours = [
			mk('2026-05-21T08:00', { waveHsM: 0.3 }),
			mk('2026-05-21T09:00', { waveHsM: 0.3 }),
			mk('2026-05-21T10:00', { waveHsM: 1.5 }),
			mk('2026-05-21T11:00', { waveHsM: 0.3 }),
			mk('2026-05-21T12:00', { waveHsM: 0.3 })
		];
		const windows = findBestWindows(hours, 2, 'sea');
		expect(windows[0].startTime).toBe('2026-05-21T08:00');
		const veto = windows.find((w) => w.startTime === '2026-05-21T09:00' || w.startTime === '2026-05-21T10:00');
		expect(veto?.score).toBe(0);
	});

	it('returns empty array when duration > available hours', () => {
		const hours = [mk('2026-05-21T08:00')];
		expect(findBestWindows(hours, 4, 'land')).toEqual([]);
	});

	it('respects minStartHour filter', () => {
		const hours = [
			mk('2026-05-21T06:00', { waveHsM: 0.3 }),
			mk('2026-05-21T07:00', { waveHsM: 0.3 }),
			mk('2026-05-21T08:00', { waveHsM: 0.3 }),
			mk('2026-05-21T09:00', { waveHsM: 0.3 })
		];
		const windows = findBestWindows(hours, 2, 'sea', 8);
		expect(windows).toHaveLength(1);
		expect(windows[0].startHour).toBe(8);
	});

	it('avgScore tiebreaks equal min scores', () => {
		const hours = [
			mk('2026-05-21T08:00', { waveHsM: 0.3, gustKn: 8 }),
			mk('2026-05-21T09:00', { waveHsM: 0.3, gustKn: 8 }),
			mk('2026-05-21T10:00', { waveHsM: 0.3, gustKn: 18 }),
			mk('2026-05-21T11:00', { waveHsM: 0.3, gustKn: 8 })
		];
		const windows = findBestWindows(hours, 2, 'sea');
		expect(windows[0].score).toBeGreaterThan(0);
	});
});

describe('detectMode and resolveMode', () => {
	it('detectMode returns sea when ≥60% hours have waves', () => {
		const hours = [
			mk('t', { waveHsM: 0.5 }),
			mk('t', { waveHsM: 0.5 }),
			mk('t', { waveHsM: null })
		];
		expect(detectMode(hours)).toBe('sea');
	});

	it('detectMode returns land when <60% hours have waves', () => {
		const hours = [
			mk('t', { waveHsM: 0.5 }),
			mk('t', { waveHsM: null }),
			mk('t', { waveHsM: null })
		];
		expect(detectMode(hours)).toBe('land');
	});

	it('resolveMode passes through explicit mode', () => {
		const hours = [mk('t', { waveHsM: null })];
		expect(resolveMode('sea', hours)).toBe('sea');
		expect(resolveMode('land', hours)).toBe('land');
	});

	it('resolveMode auto-detects when mode=auto', () => {
		const hours = [mk('t', { waveHsM: 0.5 }), mk('t', { waveHsM: 0.5 })];
		expect(resolveMode('auto', hours)).toBe('sea');
	});
});

describe('scoreToCss', () => {
	it('maps score 0 to red hue', () => {
		const { bg, border } = scoreToCss(0);
		expect(bg).toContain('hsla(0');
		expect(border).toContain('hsl(0');
	});

	it('maps score 100 to green hue', () => {
		const { bg, border } = scoreToCss(100);
		expect(bg).toContain('hsla(120');
		expect(border).toContain('hsl(120');
	});

	it('clamps out-of-range scores', () => {
		expect(scoreToCss(150).border).toContain('hsl(120');
		expect(scoreToCss(-10).border).toContain('hsl(0');
	});
});
