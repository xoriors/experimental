import { describe, it, expect } from 'vitest';
import { fuseRoute, mergeSinglePoint, aggregate3h } from '../src/lib/fusion';
import type { ForecastHour, MarineHour } from '../src/lib/types';

function mkHour(time: string, override: Partial<ForecastHour> = {}): ForecastHour {
	return {
		time,
		tempC: 25,
		apparentC: 26,
		precipMmH: 0,
		rainMmH: 0,
		showersMmH: 0,
		pop: 0,
		weatherCode: 0,
		cloudPct: 0,
		visKm: 10,
		windKn: 5,
		gustKn: 8,
		windDirDeg: 0,
		humidityPct: 70,
		pressureHpa: 1010,
		...override
	};
}

function mkMarine(time: string, override: Partial<MarineHour> = {}): MarineHour {
	return {
		time,
		waveHsM: 0.3,
		waveDirDeg: 250,
		wavePeriodS: 5,
		swellHsM: 0.2,
		swellDirDeg: 245,
		swellPeriodS: 5,
		...override
	};
}

describe('fusion', () => {
	it('fuseRoute takes max wind/wave/rain and min vis', () => {
		const pointA = {
			forecast: [mkHour('2026-05-20T10:00', { windKn: 10, gustKn: 16, precipMmH: 1, visKm: 5 })],
			marine: [mkMarine('2026-05-20T10:00', { waveHsM: 0.5 })]
		};
		const pointB = {
			forecast: [mkHour('2026-05-20T10:00', { windKn: 15, gustKn: 22, precipMmH: 0.5, visKm: 3 })],
			marine: [mkMarine('2026-05-20T10:00', { waveHsM: 0.9 })]
		};
		const fused = fuseRoute([pointA, pointB]);
		expect(fused).toHaveLength(1);
		expect(fused[0].windKn).toBe(15);
		expect(fused[0].gustKn).toBe(22);
		expect(fused[0].precipMmH).toBe(1);
		expect(fused[0].visKm).toBe(3);
		expect(fused[0].waveHsM).toBe(0.9);
	});

	it('mergeSinglePoint pairs forecast with marine hour-by-hour', () => {
		const f = [mkHour('2026-05-20T10:00'), mkHour('2026-05-20T11:00')];
		const m = [mkMarine('2026-05-20T10:00', { waveHsM: 0.7 }), mkMarine('2026-05-20T11:00', { waveHsM: 0.8 })];
		const merged = mergeSinglePoint(f, m);
		expect(merged[0].waveHsM).toBe(0.7);
		expect(merged[1].waveHsM).toBe(0.8);
	});

	it('aggregate3h groups hours into 3h slots', () => {
		const hours = [
			{ ...mkHour('2026-05-20T08:00'), waveHsM: null, wavePeriodS: null, swellHsM: null },
			{ ...mkHour('2026-05-20T09:00', { windKn: 15 }), waveHsM: null, wavePeriodS: null, swellHsM: null },
			{ ...mkHour('2026-05-20T10:00'), waveHsM: null, wavePeriodS: null, swellHsM: null },
			{ ...mkHour('2026-05-20T11:00'), waveHsM: null, wavePeriodS: null, swellHsM: null },
			{ ...mkHour('2026-05-20T12:00', { precipMmH: 4 }), waveHsM: null, wavePeriodS: null, swellHsM: null }
		];
		const slots = aggregate3h(hours);
		const slot6 = slots.find((s) => s.startHour === 6);
		const slot9 = slots.find((s) => s.startHour === 9);
		const slot12 = slots.find((s) => s.startHour === 12);
		expect(slot6?.hours).toHaveLength(1);
		expect(slot9?.agg.windKn).toBe(15);
		expect(slot12?.agg.precipMmH).toBe(4);
	});
});
