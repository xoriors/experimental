import { describe, it, expect } from 'vitest';
import { filterHoursForDay, localIsoDate, isoOfDayOffset } from '../src/lib/time';

describe('localIsoDate', () => {
	it('returns local Y-M-D, not UTC, for a date just past local midnight in +07:00', () => {
		const d = new Date(2026, 4, 21, 0, 30);
		expect(localIsoDate(d)).toBe('2026-05-21');
	});
	it('pads single-digit months and days', () => {
		expect(localIsoDate(new Date(2026, 0, 3, 12, 0))).toBe('2026-01-03');
	});
});

describe('filterHoursForDay', () => {
	const hours = [
		{ time: '2026-05-20T22:00' },
		{ time: '2026-05-21T00:00' },
		{ time: '2026-05-21T10:30' },
		{ time: '2026-05-21T23:00' },
		{ time: '2026-05-22T05:00' }
	];

	it('filters hours that match the referenceIso local date', () => {
		const r = filterHoursForDay(hours, 'today', '2026-05-21');
		expect(r.map((h) => h.time)).toEqual([
			'2026-05-21T00:00',
			'2026-05-21T10:30',
			'2026-05-21T23:00'
		]);
	});

	it('tomorrow returns hours for the next day', () => {
		const r = filterHoursForDay(hours, 'tomorrow', '2026-05-21');
		expect(r.map((h) => h.time)).toEqual(['2026-05-22T05:00']);
	});

	it('handles month boundary crossing for tomorrow', () => {
		const r = filterHoursForDay(
			[{ time: '2026-05-31T23:00' }, { time: '2026-06-01T05:00' }],
			'tomorrow',
			'2026-05-31'
		);
		expect(r.map((h) => h.time)).toEqual(['2026-06-01T05:00']);
	});
});

describe('isoOfDayOffset', () => {
	it('preserves local date when offsetting', () => {
		const d = new Date(2026, 4, 21, 23, 30);
		expect(isoOfDayOffset(d, 1)).toBe('2026-05-22');
	});
});
