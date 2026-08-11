/**
 * A physical-ish model of how bright and what colour the sky is during an
 * eclipse. Two things drive it: how high the Sun is (this eclipse happens near
 * sunset over Spain, so the sky is already deep orange before the Moon does
 * anything) and how much of the Sun is covered.
 */

import { clamp } from '../eclipse/besselian';

export interface SkyState {
	/** Relative illumination, 1 = full uneclipsed daylight for that Sun altitude. */
	light: number;
	/** Zenith sky colour. */
	zenith: [number, number, number];
	/** Colour at the horizon, in the direction of the Sun. */
	horizonSunward: [number, number, number];
	/** Colour at the horizon away from the Sun. */
	horizonOpposite: [number, number, number];
	/** 0 = full daylight, 1 = as dark as it gets. Drives stars and landscape. */
	darkness: number;
}

/**
 * Fraction of the Sun's *light* still reaching us. This is not the same as the
 * uncovered area: the Sun's disc is much brighter in the middle than at the
 * edge, so the first and last slivers of an eclipse count for less than their
 * area suggests. Uses a standard quadratic limb-darkening law.
 */
export function remainingLight(obscuredArea: number, magnitude: number): number {
	const uncovered = clamp(1 - obscuredArea, 0, 1);
	if (uncovered <= 0) return 0;
	// The Moon eats the limb first and the bright centre last, so weight the
	// remaining area towards the limb while the eclipse is shallow and towards
	// the centre when it is deep.
	const centreWeight = clamp(magnitude, 0, 1);
	const limbBias = 1 - 0.35 * centreWeight;
	return clamp(Math.pow(uncovered, limbBias), 0, 1);
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
	const k = clamp(t, 0, 1);
	return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function scale(c: [number, number, number], k: number): [number, number, number] {
	return [c[0] * k, c[1] * k, c[2] * k];
}

export function rgb(c: [number, number, number], alpha = 1): string {
	const r = Math.round(clamp(c[0], 0, 255));
	const g = Math.round(clamp(c[1], 0, 255));
	const b = Math.round(clamp(c[2], 0, 255));
	return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/** Sky colours for an uneclipsed Sun at a given altitude. */
function baseSky(altitude: number): {
	zenith: [number, number, number];
	sunward: [number, number, number];
	opposite: [number, number, number];
	light: number;
} {
	// Day -> golden hour -> civil twilight -> night.
	const dayZenith: [number, number, number] = [78, 134, 206];
	const dayHorizon: [number, number, number] = [168, 197, 226];
	const goldZenith: [number, number, number] = [64, 106, 170];
	const goldSunward: [number, number, number] = [244, 155, 74];
	const goldOpposite: [number, number, number] = [110, 128, 168];
	const duskZenith: [number, number, number] = [24, 36, 74];
	const duskSunward: [number, number, number] = [176, 78, 62];
	const duskOpposite: [number, number, number] = [36, 44, 82];
	const nightZenith: [number, number, number] = [6, 9, 22];
	const nightHorizon: [number, number, number] = [14, 18, 36];

	if (altitude > 20) {
		const t = clamp((altitude - 20) / 25, 0, 1);
		return {
			zenith: mix(goldZenith, dayZenith, t),
			sunward: mix(goldSunward, dayHorizon, t),
			opposite: mix(goldOpposite, dayHorizon, t),
			light: 1
		};
	}
	if (altitude > 0) {
		// Golden hour: the Sun is up but reddened by a long air path.
		const t = clamp(altitude / 20, 0, 1);
		return {
			zenith: mix(duskZenith, goldZenith, t),
			sunward: mix(duskSunward, goldSunward, t),
			opposite: mix(duskOpposite, goldOpposite, t),
			light: 0.25 + 0.75 * t
		};
	}
	// Below the horizon: twilight fading to night.
	const t = clamp((altitude + 12) / 12, 0, 1);
	return {
		zenith: mix(nightZenith, duskZenith, t),
		sunward: mix(nightHorizon, duskSunward, t),
		opposite: mix(nightHorizon, duskOpposite, t),
		light: 0.25 * Math.pow(t, 2.2)
	};
}

/**
 * Sky state for a given Sun altitude and eclipse depth.
 *
 * The eye adapts, so nothing much appears to happen until the Sun is more than
 * about 90 percent covered; the last minute before totality is when the light
 * collapses. That non-linearity is the whole reason a deep partial eclipse and
 * a total one feel like different events, so it is modelled explicitly here.
 */
export function skyState(sunAltitude: number, obscuredArea: number, magnitude: number): SkyState {
	const base = baseSky(sunAltitude);
	const light = remainingLight(obscuredArea, magnitude);

	// Perceived brightness follows roughly the cube root of luminance.
	const perceived = Math.pow(light, 1 / 2.6);

	// During totality the sky is lit only by sunlight scattered in from outside
	// the umbra, a few hundred kilometres away: roughly deep civil twilight.
	const totalityFloor = 0.055;
	const perceivedFloor = Math.max(perceived, obscuredArea >= 1 ? totalityFloor : 0);

	const darkness = clamp(1 - perceivedFloor, 0, 1);

	// As the light fails the sky loses its blue first and goes steely grey-violet.
	const eclipseTint: [number, number, number] = [40, 44, 72];
	const tintAmount = clamp((1 - perceivedFloor) * 1.15, 0, 0.92);

	const zenith = scale(mix(base.zenith, eclipseTint, tintAmount), 0.25 + 0.75 * perceivedFloor);

	// The horizon keeps a ring of sunset colour right through totality, because
	// the umbra is only a few hundred km wide and beyond it the Sun still shines.
	const glow: [number, number, number] = [196, 104, 72];
	const horizonSunward = scale(
		mix(base.sunward, glow, tintAmount * 0.75),
		0.3 + 0.7 * perceivedFloor
	);
	const horizonOpposite = scale(
		mix(base.opposite, glow, tintAmount * 0.55),
		0.28 + 0.72 * perceivedFloor
	);

	return { light, zenith, horizonSunward, horizonOpposite, darkness };
}

/**
 * How visible a star of a given magnitude is against the current sky.
 * Returns 0 (invisible) to 1 (obvious).
 */
export function starVisibility(starMagnitude: number, darkness: number): number {
	// Limiting magnitude climbs steeply as the sky darkens.
	const limit = -5 + 11 * Math.pow(clamp(darkness, 0, 1), 3.2);
	return clamp((limit - starMagnitude) * 0.7, 0, 1);
}
