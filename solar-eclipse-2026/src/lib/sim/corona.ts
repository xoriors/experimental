/**
 * The corona: the reason people cross oceans for two minutes of shade.
 *
 * Rendered once into an offscreen canvas and reused, because it does not change
 * over the couple of minutes of totality. The radial fall-off is the empirical
 * Baumbach-Allen profile; the streamers are procedural but shaped to match what
 * the corona actually looks like near solar maximum, which is where the Sun will
 * be in August 2026 — a fairly round corona with streamers at all latitudes,
 * rather than the two-lobed equatorial shape seen at solar minimum.
 */

/** Deterministic small PRNG so the corona is identical on every render. */
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
 * Brightness of the K+F corona at r solar radii, relative to the solar disc.
 * Baumbach's empirical formula, in units of 1e-6 of the mean disc brightness.
 */
function radialProfile(r: number): number {
	if (r < 1) return 0;
	return 0.0532 * Math.pow(r, -2.5) + 1.425 * Math.pow(r, -7) + 2.565 * Math.pow(r, -17);
}

interface Streamer {
	angle: number;
	width: number;
	strength: number;
	reach: number;
}

function makeStreamers(random: () => number): Streamer[] {
	const streamers: Streamer[] = [];
	// Near solar maximum streamers appear at all position angles.
	const count = 13;
	for (let i = 0; i < count; i++) {
		const jitter = (random() - 0.5) * 0.55;
		streamers.push({
			angle: (i / count) * Math.PI * 2 + jitter,
			// Keep the angular width well under the spacing between streamers,
			// otherwise they overlap into a featureless glow.
			width: 0.075 + random() * 0.14,
			strength: 0.7 + random() * 1.6,
			reach: 1.6 + random() * 1.9
		});
	}
	return streamers;
}

export interface CoronaImage {
	canvas: HTMLCanvasElement;
	/** Solar radii represented by half the canvas width. */
	extent: number;
}

/**
 * Draw the corona into an offscreen canvas. `size` is the pixel size of the
 * square image; `extent` is how many solar radii the half-width covers.
 */
export function renderCorona(size = 768, extent = 4, seed = 20260812): CoronaImage {
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const image = ctx.createImageData(size, size);
	const data = image.data;

	const random = mulberry32(seed);
	const streamers = makeStreamers(random);

	// Fine-scale radial structure, the thin threads visible in good photographs.
	// Kept subtle: too many hard threads make the corona look like a starburst
	// rather than the soft, layered structure it actually has.
	const threadCount = 70;
	const threads = Array.from({ length: threadCount }, () => ({
		angle: random() * Math.PI * 2,
		width: 0.006 + random() * 0.022,
		strength: 0.18 + random() * 0.5,
		reach: 0.7 + random() * 1.0
	}));

	const centre = size / 2;
	const pixelsPerRadius = centre / extent;

	// Normalise so the corona just off the limb reads as bright white.
	const reference = radialProfile(1.02);

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = (x - centre) / pixelsPerRadius;
			const dy = (y - centre) / pixelsPerRadius;
			const r = Math.hypot(dx, dy);
			const index = (y * size + x) * 4;

			if (r < 0.995 || r > extent) {
				data[index + 3] = 0;
				continue;
			}

			const theta = Math.atan2(dy, dx);
			let modulation = 0.42;

			for (const s of streamers) {
				let delta = theta - s.angle;
				delta = Math.atan2(Math.sin(delta), Math.cos(delta));
				const angular = Math.exp(-(delta * delta) / (2 * s.width * s.width));
				const radial = Math.exp(-Math.max(0, r - 1) / s.reach);
				modulation += s.strength * angular * radial;
			}

			for (const t of threads) {
				let delta = theta - t.angle;
				delta = Math.atan2(Math.sin(delta), Math.cos(delta));
				const angular = Math.exp(-(delta * delta) / (2 * t.width * t.width));
				const radial = Math.exp(-Math.max(0, r - 1) / t.reach);
				modulation += t.strength * angular * radial * 0.45;
			}

			// Slight equatorial elongation even at solar maximum.
			modulation *= 1 + 0.18 * Math.cos(2 * theta);

			const brightness = (radialProfile(r) / reference) * modulation;

			// Compress the enormous dynamic range into something a screen can show.
			const value = Math.pow(Math.min(1, brightness * 0.5), 0.55);
			if (value <= 0.002) {
				data[index + 3] = 0;
				continue;
			}

			// The corona is very slightly warm-white close in, neutral further out.
			const warmth = Math.exp(-(r - 1) * 0.7);
			data[index] = 255;
			data[index + 1] = 252 - 6 * (1 - warmth);
			data[index + 2] = 244 - 18 * (1 - warmth);
			data[index + 3] = Math.round(Math.min(255, value * 255));
		}
	}

	ctx.putImageData(image, 0, 0);
	return { canvas, extent };
}

export interface Prominence {
	/** Position angle around the limb, radians. */
	angle: number;
	/** Height above the limb in solar radii. */
	height: number;
	/** Angular extent along the limb, radians. */
	width: number;
}

/** A handful of prominences, the pink flames visible right at the Moon's edge. */
export function makeProminences(seed = 8122026): Prominence[] {
	const random = mulberry32(seed);
	const count = 6;
	return Array.from({ length: count }, () => ({
		angle: random() * Math.PI * 2,
		// A big prominence reaches perhaps 5 percent of a solar radius.
		height: 0.02 + random() * 0.05,
		width: 0.03 + random() * 0.06
	}));
}
