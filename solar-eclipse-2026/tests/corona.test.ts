import { describe, expect, it } from 'vitest';
import { coronaPixels } from '../src/lib/sim/corona';

/**
 * The corona texture is the most expensive thing the site computes, and it now
 * runs in a worker. That only works if it touches no DOM at all — which this
 * suite proves by running it under Node, where there is none.
 */
describe('the corona texture', () => {
	const size = 96;
	const extent = 4;
	const pixels = coronaPixels(size, extent, 20260812);
	const alphaAt = (radii: number) => {
		// Sample along +x from the centre, at the given distance in solar radii.
		const x = Math.round(size / 2 + (radii * size) / (2 * extent));
		const y = Math.round(size / 2);
		return pixels[(y * size + x) * 4 + 3];
	};

	it('fills exactly the buffer it promises', () => {
		expect(pixels).toHaveLength(size * size * 4);
	});

	it('leaves the occulting disc clear, so the sky shows through', () => {
		// Anything drawn inside the occulting disc would wash out the one part of
		// the image that has to be perfectly black.
		for (const radii of [0, 0.4, 0.9]) expect(alphaAt(radii), `${radii} radii`).toBe(0);
	});

	it('is brightest just off the limb and fades outwards', () => {
		const near = alphaAt(1.1);
		const mid = alphaAt(2);
		const far = alphaAt(3.5);
		expect(near).toBeGreaterThan(0);
		expect(near).toBeGreaterThan(mid);
		expect(mid).toBeGreaterThanOrEqual(far);
	});

	it('stops at the edge of its own frame', () => {
		// Beyond `extent` there is nothing, so the square never shows its corners.
		expect(pixels[3]).toBe(0);
		expect(pixels[pixels.length - 1]).toBe(0);
	});

	it('is the same image every time, so the sky does not flicker on a redraw', () => {
		const again = coronaPixels(size, extent, 20260812);
		expect(Array.from(again)).toEqual(Array.from(pixels));
	});

	it('gives a different corona for a different seed', () => {
		const other = coronaPixels(size, extent, 12345);
		expect(Array.from(other)).not.toEqual(Array.from(pixels));
	});
});
