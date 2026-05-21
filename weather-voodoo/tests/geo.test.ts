import { describe, it, expect } from 'vitest';
import { haversineKm, midpoint, sampleAlongPolyline, sampleAlongRoute } from '../src/lib/geo';

describe('geo', () => {
	it('haversine returns ~33 km Phi Phi to Ao Nang', () => {
		const phiphi = { lat: 7.7388, lon: 98.7784 };
		const aonang = { lat: 8.034, lon: 98.825 };
		const d = haversineKm(phiphi, aonang);
		expect(d).toBeGreaterThan(30);
		expect(d).toBeLessThan(40);
	});

	it('midpoint lies between two equatorial points', () => {
		const m = midpoint({ lat: 0, lon: 0 }, { lat: 0, lon: 10 });
		expect(m.lat).toBeCloseTo(0, 5);
		expect(m.lon).toBeCloseTo(5, 1);
	});

	it('sampleAlongRoute returns endpoints + interior samples', () => {
		const a = { lat: 0, lon: 0 };
		const b = { lat: 10, lon: 0 };
		const pts = sampleAlongRoute(a, b, 5);
		expect(pts.length).toBe(5);
		expect(pts[0]).toEqual(a);
		expect(pts[4]).toEqual(b);
		expect(pts[2].lat).toBeCloseTo(5, 5);
	});

	it('sampleAlongPolyline returns endpoints + by-distance interior samples', () => {
		// L-shape: 0,0 → 10,0 (≈1112 km) → 10,10 (≈1110 km)
		const line = [
			{ lat: 0, lon: 0 },
			{ lat: 10, lon: 0 },
			{ lat: 10, lon: 10 }
		];
		const pts = sampleAlongPolyline(line, 3);
		expect(pts.length).toBe(3);
		expect(pts[0]).toEqual(line[0]);
		expect(pts[2]).toEqual(line[2]);
		// Mid-distance sample should be near the corner since the two legs are
		// nearly equal-length — within a few hundred km of (10, 0).
		expect(pts[1].lat).toBeGreaterThan(8);
		expect(pts[1].lon).toBeLessThan(2);
	});

	it('sampleAlongPolyline degrades gracefully for tiny inputs', () => {
		expect(sampleAlongPolyline([], 3)).toEqual([]);
		const one = sampleAlongPolyline([{ lat: 1, lon: 2 }], 3);
		expect(one).toEqual([
			{ lat: 1, lon: 2 },
			{ lat: 1, lon: 2 },
			{ lat: 1, lon: 2 }
		]);
	});
});
