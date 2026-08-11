/**
 * The Moon's edge is not a circle. Mountains and crater rims along the limb
 * stick up by a kilometre or two, and in the seconds around second and third
 * contact the last of the Sun shines through the valleys between them — Baily's
 * beads, and then the diamond ring.
 *
 * Modelling the limb as a slightly ragged outline means the beads fall out of
 * the geometry for free, appearing in the right place at the right moment,
 * rather than being faked with a sprite.
 */

/** Peak-to-peak limb relief as a fraction of the Moon's radius (~2 km on 1737 km). */
const RELIEF = 0.0013;

interface Harmonic {
	order: number;
	amplitude: number;
	phase: number;
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * A limb profile built from harmonics up to order ~70, which corresponds to
 * features a few tens of kilometres across — about right for the big crater
 * rims and massifs that actually produce beads.
 */
export function makeLimbProfile(seed = 12082026): Harmonic[] {
	const random = mulberry32(seed);
	const harmonics: Harmonic[] = [];
	for (let order = 3; order <= 70; order++) {
		// Rougher at small scales, but with less amplitude: a red-noise spectrum.
		const amplitude = Math.pow(order, -0.85) * (0.45 + random());
		harmonics.push({ order, amplitude, phase: random() * Math.PI * 2 });
	}
	// Normalise so the total relief matches the real Moon.
	const total = harmonics.reduce((sum, h) => sum + h.amplitude, 0);
	for (const h of harmonics) h.amplitude = (h.amplitude / total) * RELIEF;
	return harmonics;
}

/**
 * Radius of the Moon at position angle `theta`, as a multiple of its mean
 * radius. Deviations are of order 0.1 percent.
 */
export function limbRadius(harmonics: Harmonic[], theta: number): number {
	let sum = 0;
	for (const h of harmonics) sum += h.amplitude * Math.cos(h.order * theta + h.phase);
	return 1 + sum;
}

/** Build a closed path of the Moon's limb, for filling on a canvas. */
export function limbPath(
	harmonics: Harmonic[],
	centreX: number,
	centreY: number,
	radius: number,
	steps = 720,
	rotation = 0
): Path2D {
	const path = new Path2D();
	for (let i = 0; i <= steps; i++) {
		const theta = (i / steps) * Math.PI * 2;
		const r = radius * limbRadius(harmonics, theta + rotation);
		const x = centreX + r * Math.cos(theta);
		const y = centreY + r * Math.sin(theta);
		if (i === 0) path.moveTo(x, y);
		else path.lineTo(x, y);
	}
	path.closePath();
	return path;
}
