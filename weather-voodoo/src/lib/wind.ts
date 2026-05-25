/**
 * Wind angle relative to a direction of travel — the "head/cross/tail" read-out
 * that tells a sailor or cyclist whether the wind is in their face or pushing
 * them forward.
 */

/** Normalize an angle in degrees to [-180, 180). */
export function normalizeDeg180(deg: number): number {
	let d = ((deg + 180) % 360) - 180;
	if (d < -180) d += 360;
	if (d >= 180) d -= 360;
	return d;
}

/**
 * Compute the wind angle relative to the direction of travel.
 *
 * Meteorological convention: `windDirDeg` is the direction the wind is FROM
 * (0° = wind from north, 90° = wind from east). `headingDeg` is the bearing
 * of travel (same convention). The returned angle is in [-180, 180]:
 *
 *     0    → wind coming FROM ahead (head wind)
 *   ±180   → wind coming FROM behind (tail wind)
 *    +90   → wind coming FROM starboard / right
 *    -90   → wind coming FROM port / left
 */
export function relativeWindDeg(windDirDeg: number, headingDeg: number): number {
	return normalizeDeg180(windDirDeg - headingDeg);
}

export type RelativeWindClass = 'head' | 'head-cross' | 'cross' | 'tail-cross' | 'tail';

/**
 * Bucket a relative wind angle into one of five classes. Bands match the
 * spec on issue #37:
 *   |rel| ≤ 30°       → head
 *   30° < |rel| ≤ 60° → head-cross
 *   60° < |rel| < 120°→ cross
 *   120° ≤ |rel| < 150°→ tail-cross
 *   |rel| ≥ 150°      → tail
 */
export function classifyRelativeWind(relDeg: number): RelativeWindClass {
	const abs = Math.abs(relDeg);
	if (abs <= 30) return 'head';
	if (abs <= 60) return 'head-cross';
	if (abs < 120) return 'cross';
	if (abs < 150) return 'tail-cross';
	return 'tail';
}

/**
 * Given several relative-wind readings (one per sample point along a route at
 * the same hour), pick the worst-case one — the angle closest to a head wind,
 * matching the conservative philosophy of the existing fusion (max wind,
 * min visibility, …). Returns null on empty input.
 */
export function worstRelativeWind(relDegs: number[]): number | null {
	if (relDegs.length === 0) return null;
	let worst = relDegs[0];
	let worstAbs = Math.abs(worst);
	for (let i = 1; i < relDegs.length; i++) {
		const a = Math.abs(relDegs[i]);
		if (a < worstAbs) {
			worst = relDegs[i];
			worstAbs = a;
		}
	}
	return worst;
}
