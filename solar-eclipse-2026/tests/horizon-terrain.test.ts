import { describe, expect, it } from 'vitest';
import {
	bearing,
	destination,
	distanceM,
	horizonProfile,
	horizonSamplePoints,
	judgeView,
	compassPoint,
	SAMPLE_DISTANCES_M
} from '../src/lib/eclipse/horizon';
import { mapsDirectionsUrl, mapsPlaceUrl, streetViewUrl } from '../src/lib/eclipse/viewpoints';

describe('geodesy used to walk out along the sunset bearing', () => {
	it('lands the right distance away in the right direction', () => {
		const from = { lat: 47.6573, lon: 23.5681 };
		// Bearings are normalised to [0, 360), so due north can come back as
		// 359.999...; compare the wrapped difference rather than the raw value.
		const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
		for (const d of [150, 5500, 34000]) {
			for (const brg of [0, 90, 180, 291]) {
				const to = destination(from, brg, d);
				expect(distanceM(from, to), `${d}m @ ${brg}`).toBeCloseTo(d, 0);
				expect(angleGap(bearing(from, to), brg), `${d}m @ ${brg}`).toBeLessThan(0.05);
			}
		}
	});

	it('produces one sample per configured distance', () => {
		const points = horizonSamplePoints({ lat: 42, lon: -4.5 }, 291);
		expect(points).toHaveLength(SAMPLE_DISTANCES_M.length);
	});

	it('handles a bearing that crosses the antimeridian', () => {
		const to = destination({ lat: 64, lon: 179.98 }, 90, 30000);
		expect(to.lon).toBeGreaterThan(-180);
		expect(to.lon).toBeLessThanOrEqual(180);
		expect(distanceM({ lat: 64, lon: 179.98 }, to)).toBeCloseTo(30000, 0);
	});
});

describe('reading a skyline', () => {
	it('gives a flat plain a horizon at about zero, allowing for curvature', () => {
		const flat = SAMPLE_DISTANCES_M.map(() => 200);
		const profile = horizonProfile(200, flat);
		// Standing 1.6 m up on level ground, the skyline dips slightly below level.
		expect(profile.angle).toBeLessThan(0);
		expect(profile.angle).toBeGreaterThan(-0.2);
	});

	it('spots a near ridge and reports how far away it is', () => {
		const terrain = SAMPLE_DISTANCES_M.map((d) => (d === 800 ? 300 : 200));
		const profile = horizonProfile(200, terrain);
		// 100 m of rise at 800 m is about 7 degrees.
		expect(profile.angle).toBeCloseTo(7.1, 0);
		expect(profile.atDistanceM).toBe(800);
	});

	it('discounts a distant hill that the Earth curves away from', () => {
		const near = horizonProfile(200, SAMPLE_DISTANCES_M.map((d) => (d === 1200 ? 260 : 200)));
		const far = horizonProfile(200, SAMPLE_DISTANCES_M.map((d) => (d === 24000 ? 260 : 200)));
		// The same 60 m rise counts for far less once it is 24 km away.
		expect(near.angle).toBeGreaterThan(2.5);
		expect(far.angle).toBeLessThan(0.1);

		// Curvature drop at 24 km is about 39 m, so a 35 m rise disappears below
		// the horizon altogether.
		const swallowed = horizonProfile(200, SAMPLE_DISTANCES_M.map((d) => (d === 24000 ? 235 : 200)));
		expect(swallowed.angle).toBeLessThan(0);
	});

	it('lets height win: the same valley from higher up clears the ridge', () => {
		const terrain = SAMPLE_DISTANCES_M.map((d) => (d <= 2600 ? 500 : 200));
		expect(horizonProfile(220, terrain).angle).toBeGreaterThan(3);
		expect(horizonProfile(700, terrain).angle).toBeLessThan(0);
	});

	it('ignores gaps in the elevation data rather than reading them as sea level', () => {
		const terrain = SAMPLE_DISTANCES_M.map(() => Number.NaN);
		terrain[3] = 300;
		const profile = horizonProfile(200, terrain);
		expect(profile.samples).toHaveLength(1);
		expect(profile.atDistanceM).toBe(SAMPLE_DISTANCES_M[3]);
	});
});

describe('turning that into advice', () => {
	it('grades clearance the way a driver would want', () => {
		expect(judgeView(8, 1).quality).toBe('clear');
		expect(judgeView(3, 1).quality).toBe('likely');
		expect(judgeView(1.2, 0.7).quality).toBe('marginal');
		expect(judgeView(0.5, 2).quality).toBe('blocked');
	});

	it('reports clearance as a signed number of degrees', () => {
		expect(judgeView(8, 1).clearanceDeg).toBeCloseTo(7, 6);
		expect(judgeView(0.5, 2).clearanceDeg).toBeCloseTo(-1.5, 6);
	});

	it('names the direction to drive', () => {
		expect(compassPoint(0)).toBe('N');
		expect(compassPoint(291)).toBe('WNW');
		expect(compassPoint(359.9)).toBe('N');
	});
});

describe('Google Maps links', () => {
	const spot = { lat: 47.674794, lon: 23.591289 };

	it('builds a place link with the documented scheme', () => {
		expect(mapsPlaceUrl(spot)).toBe(
			'https://www.google.com/maps/search/?api=1&query=47.674794,23.591289'
		);
	});

	it('builds driving directions', () => {
		expect(mapsDirectionsUrl(spot)).toContain('dir/?api=1&destination=47.674794,23.591289');
		expect(mapsDirectionsUrl(spot)).toContain('travelmode=driving');
	});

	it('opens Street View facing the setting Sun', () => {
		const url = streetViewUrl(spot, 291.4);
		expect(url).toContain('map_action=pano');
		expect(url).toContain('viewpoint=47.674794,23.591289');
		expect(url).toContain('heading=291');
	});

	it('normalises a heading that has wrapped past a full turn', () => {
		expect(streetViewUrl(spot, -69)).toContain('heading=291');
		expect(streetViewUrl(spot, 651)).toContain('heading=291');
	});
});
