import { describe, it, expect } from 'vitest';
import { scoreHour, summariseHour } from '../src/lib/activities';
import type { FusedHour } from '../src/lib/types';

function hour(override: Partial<FusedHour> = {}): FusedHour {
	return {
		time: '2026-05-20T12:00',
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

describe('activities', () => {
	it('warm calm sunny → swimming and sunbathing both good', () => {
		const v = scoreHour(hour({ tempC: 28, windKn: 6, waveHsM: 0.2, cloudPct: 20, precipMmH: 0 }));
		expect(v.swimming).toBe('good');
		expect(v.sunbathing).toBe('good');
		expect(v.kayaking).toBe('good');
	});

	it('big waves → kayaking unsafe', () => {
		const v = scoreHour(hour({ waveHsM: 1.5, windKn: 18 }));
		expect(v.kayaking).toBe('unsafe');
	});

	it('storm → ferry/boat unsafe', () => {
		const v = scoreHour(hour({ waveHsM: 3, gustKn: 40, precipMmH: 8 }));
		expect(v.ferryOrBoat).toBe('unsafe');
		expect(v.sightseeing).toBe('unsafe');
	});

	it('heavy rain low vis → hiking poor or worse', () => {
		const v = scoreHour(hour({ precipMmH: 3, visKm: 0.8 }));
		expect(['poor', 'unsafe']).toContain(v.hiking);
	});

	it('summarise mentions good and avoid lists', () => {
		const line = summariseHour(hour({ tempC: 28, windKn: 6, waveHsM: 1.5, gustKn: 25 }));
		expect(line).toMatch(/Good for/i);
		expect(line).toMatch(/Avoid/i);
	});

	it('marine-absent (inland) → kayaking treats waveHs=null as 0', () => {
		const v = scoreHour(hour({ waveHsM: null, windKn: 5, precipMmH: 0 }));
		expect(v.kayaking).toBe('good');
	});
});
