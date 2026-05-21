import { describe, it, expect } from 'vitest';
import { dayLookup, isDaylight, sunPhase } from '../src/lib/daylight';
import type { DaylightDay } from '../src/lib/types';

const dl: DaylightDay = {
	date: '2026-05-21',
	sunrise: '2026-05-21T06:00',
	sunset: '2026-05-21T18:30'
};

describe('isDaylight', () => {
	it('treats sunrise → sunset as day', () => {
		expect(isDaylight('2026-05-21T06:00', dl)).toBe(true);
		expect(isDaylight('2026-05-21T12:00', dl)).toBe(true);
		expect(isDaylight('2026-05-21T18:00', dl)).toBe(true);
	});
	it('treats before sunrise / at-or-after sunset as night', () => {
		expect(isDaylight('2026-05-21T05:00', dl)).toBe(false);
		expect(isDaylight('2026-05-21T18:30', dl)).toBe(false);
		expect(isDaylight('2026-05-21T22:00', dl)).toBe(false);
	});
	it('defaults to true if no daylight info', () => {
		expect(isDaylight('2026-05-21T03:00', undefined)).toBe(true);
	});
});

describe('sunPhase', () => {
	it('labels the sunrise hour and sunset hour', () => {
		expect(sunPhase('2026-05-21T06:00', dl)).toBe('sunrise-hour');
		expect(sunPhase('2026-05-21T18:00', dl)).toBe('sunset-hour');
	});
	it('labels other hours appropriately', () => {
		expect(sunPhase('2026-05-21T03:00', dl)).toBe('pre-dawn');
		expect(sunPhase('2026-05-21T12:00', dl)).toBe('day');
		expect(sunPhase('2026-05-21T22:00', dl)).toBe('night');
	});
});

describe('dayLookup', () => {
	it('keys by date', () => {
		const m = dayLookup([dl]);
		expect(m.get('2026-05-21')).toBe(dl);
		expect(m.get('2026-05-22')).toBeUndefined();
	});
});
