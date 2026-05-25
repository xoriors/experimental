import { describe, it, expect } from 'vitest';
import { chevronsForHour, worstClass } from '../src/lib/wind-map';
import type { WindSample } from '../src/lib/types';
import type { RelativeWindClass } from '../src/lib/wind';

const labelOf = (c: RelativeWindClass): string =>
	({
		head: 'Head',
		'head-cross': 'Head-Cross',
		cross: 'Cross',
		'tail-cross': 'Tail-Cross',
		tail: 'Tail'
	})[c];

describe('wind-map', () => {
	it('chevronsForHour pairs each sample with its hourly wind and classifies', () => {
		const samples: WindSample[] = [
			{
				point: { lat: 7.74, lon: 98.78 },
				headingDeg: 0, // heading north
				hours: [
					{ time: '2026-05-24T08:00', windDirDeg: 0, windKn: 12, gustKn: 18 }, // wind FROM north = head
					{ time: '2026-05-24T09:00', windDirDeg: 180, windKn: 10, gustKn: 14 } // tail
				]
			},
			{
				point: { lat: 8.05, lon: 98.81 },
				headingDeg: 0,
				hours: [
					{ time: '2026-05-24T08:00', windDirDeg: 90, windKn: 14, gustKn: 20 }, // cross (right)
					{ time: '2026-05-24T09:00', windDirDeg: 135, windKn: 8, gustKn: 12 } // tail-cross
				]
			}
		];
		const chevrons = chevronsForHour(samples, '2026-05-24T08:00', labelOf);
		expect(chevrons.length).toBe(2);
		expect(chevrons[0].cls).toBe('head');
		expect(chevrons[0].classLabel).toBe('Head');
		expect(chevrons[1].cls).toBe('cross');
	});

	it('chevronsForHour skips samples that have no matching hour', () => {
		const samples: WindSample[] = [
			{
				point: { lat: 0, lon: 0 },
				headingDeg: 0,
				hours: [{ time: '2026-05-24T08:00', windDirDeg: 0, windKn: 10, gustKn: 15 }]
			},
			{
				point: { lat: 1, lon: 1 },
				headingDeg: 0,
				hours: [] // empty
			}
		];
		const chevrons = chevronsForHour(samples, '2026-05-24T08:00', labelOf);
		expect(chevrons.length).toBe(1);
	});

	it('worstClass picks the most head-on class across chevrons', () => {
		expect(worstClass([])).toBeNull();
		const samples: WindSample[] = [
			{
				point: { lat: 0, lon: 0 },
				headingDeg: 0,
				hours: [
					{ time: '2026-05-24T08:00', windDirDeg: 180, windKn: 8, gustKn: 12 }, // tail
					{ time: '2026-05-24T09:00', windDirDeg: 45, windKn: 8, gustKn: 12 } // head-cross
				]
			},
			{
				point: { lat: 1, lon: 1 },
				headingDeg: 0,
				hours: [
					{ time: '2026-05-24T08:00', windDirDeg: 0, windKn: 10, gustKn: 15 }, // head
					{ time: '2026-05-24T09:00', windDirDeg: 170, windKn: 10, gustKn: 15 } // tail
				]
			}
		];
		expect(worstClass(chevronsForHour(samples, '2026-05-24T08:00', labelOf))).toBe('head');
		expect(worstClass(chevronsForHour(samples, '2026-05-24T09:00', labelOf))).toBe('head-cross');
	});
});
