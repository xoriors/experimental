import { describe, expect, it } from 'vitest';
import { computeObscurationGrid, sampleGrid, umbraAt } from '../src/lib/map/eclipse-path';
import { localCircumstances, maximumDepth } from '../src/lib/eclipse/local';

/**
 * The map used to do its arithmetic the thorough way and freeze the page for
 * seconds doing it. These check that the quick way gives the same answers.
 */
describe('the cheap route to the depth of the eclipse', () => {
	const places = [
		{ name: 'Palencia, on the centre line', lat: 42.0096, lon: -4.5288 },
		{ name: 'Paris, a deep partial', lat: 48.8566, lon: 2.3522 },
		{ name: 'greatest eclipse, mid-Atlantic', lat: 65.2, lon: -25.2 },
		{ name: 'Bucharest, where the Sun has set', lat: 44.43, lon: 26.1 },
		{ name: 'Cape Town, which sees nothing', lat: -33.93, lon: 18.42 }
	];

	it('agrees exactly with the full solve, which is what it replaced', () => {
		// Not "approximately": it is the same geometry at the same instant, so any
		// disagreement at all would mean one of them is computing something else.
		for (const place of places) {
			const full = localCircumstances(place);
			const quick = maximumDepth(place);
			expect(quick.obscuration, place.name).toBeCloseTo(full.maxObscuration, 12);
			expect(quick.altitude, place.name).toBeCloseTo(full.max.altitude, 12);
		}
	});

	it('does not need four contact solves and a horizon scan to do it', () => {
		// A guard on the thing that actually mattered: 16,652 grid points at the
		// full cost was two seconds, and the whole grid should now be a fraction
		// of the cost of solving the same points thoroughly.
		const sample = places.map((p) => ({ lat: p.lat, lon: p.lon }));
		const started = performance.now();
		for (let i = 0; i < 200; i++) for (const at of sample) maximumDepth(at);
		const quick = performance.now() - started;

		const thorough = performance.now();
		for (let i = 0; i < 200; i++) for (const at of sample) localCircumstances(at);
		expect(quick).toBeLessThan((performance.now() - thorough) / 4);
	});
});

describe('the obscuration grid', () => {
	// Coarse on purpose: this is about the values, not the resolution.
	const grid = computeObscurationGrid(-80, 55, 18, 86, 2);

	it('is deepest on the path and shallower away from it', () => {
		const onPath = sampleGrid(grid, -4.53, 42.01);
		const paris = sampleGrid(grid, 2.35, 48.86);
		const naples = sampleGrid(grid, 14.27, 40.85);
		expect(onPath).toBeGreaterThan(0.9);
		expect(paris).toBeLessThan(onPath);
		expect(naples).toBeLessThan(paris);
	});

	it('gives nothing to places where the Sun is already down', () => {
		// Bucharest reaches 90% geometrically and sees essentially none of it.
		expect(sampleGrid(grid, 26.1, 44.43)).toBeLessThan(0.1);
	});

	it('reads as zero outside its own bounds rather than throwing', () => {
		expect(sampleGrid(grid, 120, 35)).toBe(0);
		expect(sampleGrid(grid, -4.53, -20)).toBe(0);
	});
});

describe('the umbra outline', () => {
	const t = 0.5;

	it('returns as many points as asked for', () => {
		expect(umbraAt(t, 48)).toHaveLength(48);
		expect(umbraAt(t, 160)).toHaveLength(160);
	});

	it('describes the same shadow whatever the resolution', () => {
		// The zoom decides how finely the ring is drawn; it must not decide where
		// the shadow is.
		const coarse = umbraAt(t, 48)!;
		const fine = umbraAt(t, 160)!;
		const centroid = (ring: Array<[number, number]>) => [
			ring.reduce((s, p) => s + p[0], 0) / ring.length,
			ring.reduce((s, p) => s + p[1], 0) / ring.length
		];
		const [lonC, latC] = centroid(coarse);
		const [lonF, latF] = centroid(fine);
		expect(lonC).toBeCloseTo(lonF, 1);
		expect(latC).toBeCloseTo(latF, 1);
	});
});
