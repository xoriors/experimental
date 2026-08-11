/**
 * Planets and bright stars, so the simulator can show what actually comes out
 * during totality. Regulus sits only about nine degrees from the Sun on this
 * date, and the bright planets are strung out along the ecliptic nearby.
 *
 * Planetary positions use JPL's approximate Keplerian elements (Standish),
 * accurate to a few arcminutes over 1800-2050 — far better than needed to place
 * a dot in the sky.
 */

import { DEG, clamp } from '../eclipse/besselian';

export interface SkyObject {
	name: string;
	/** Right ascension, degrees. */
	ra: number;
	/** Declination, degrees. */
	dec: number;
	magnitude: number;
	kind: 'planet' | 'star';
}

interface OrbitalElements {
	name: string;
	/** semi-major axis (AU), eccentricity, inclination, mean longitude,
	 *  longitude of perihelion, longitude of ascending node - and rates per century. */
	a: [number, number];
	e: [number, number];
	i: [number, number];
	l: [number, number];
	peri: [number, number];
	node: [number, number];
	/** Absolute magnitude used for a rough apparent brightness. */
	absoluteMagnitude: number;
	/**
	 * Coefficients of the phase-angle terms in the standard Astronomical Almanac
	 * brightness formulae: V = H + 5 log(r * delta) + c1*a + c2*a^2 + c3*a^3.
	 * These matter a lot for Mercury and Venus, whose phase changes hugely.
	 */
	phase: [number, number, number];
}

const PLANETS: OrbitalElements[] = [
	{
		name: 'Mercury',
		a: [0.38709927, 0.00000037],
		e: [0.20563593, 0.00001906],
		i: [7.00497902, -0.00594749],
		l: [252.2503235, 149472.67411175],
		peri: [77.45779628, 0.16047689],
		node: [48.33076593, -0.12534081],
		absoluteMagnitude: -0.36,
		phase: [0.038, -0.000273, 0.000002]
	},
	{
		name: 'Venus',
		a: [0.72333566, 0.0000039],
		e: [0.00677672, -0.00004107],
		i: [3.39467605, -0.0007889],
		l: [181.9790995, 58517.81538729],
		peri: [131.60246718, 0.00268329],
		node: [76.67984255, -0.27769418],
		absoluteMagnitude: -4.29,
		phase: [0.0009, 0.000239, -0.00000065]
	},
	{
		name: 'Mars',
		a: [1.52371034, 0.00001847],
		e: [0.0933941, 0.00007882],
		i: [1.84969142, -0.00813131],
		l: [-4.55343205, 19140.30268499],
		peri: [-23.94362959, 0.44441088],
		node: [49.55953891, -0.29257343],
		absoluteMagnitude: -1.52,
		phase: [0.016, 0, 0]
	},
	{
		name: 'Jupiter',
		a: [5.202887, -0.00011607],
		e: [0.04838624, -0.00013253],
		i: [1.30439695, -0.00183714],
		l: [34.39644051, 3034.74612775],
		peri: [14.72847983, 0.21252668],
		node: [100.47390909, 0.20469106],
		absoluteMagnitude: -9.25,
		phase: [0.005, 0, 0]
	},
	{
		name: 'Saturn',
		a: [9.53667594, -0.0012506],
		e: [0.05386179, -0.00050991],
		i: [2.48599187, 0.00193609],
		l: [49.95424423, 1222.49362201],
		peri: [92.59887831, -0.41897216],
		node: [113.66242448, -0.28867794],
		absoluteMagnitude: -8.88,
		phase: [0.044, 0, 0]
	}
];

const EARTH: OrbitalElements = {
	name: 'Earth',
	a: [1.00000261, 0.00000562],
	e: [0.01671123, -0.00004392],
	i: [-0.00001531, -0.01294668],
	l: [100.46457166, 35999.37244981],
	peri: [102.93768193, 0.32327364],
	node: [0, 0],
	absoluteMagnitude: 0,
	phase: [0, 0, 0]
};

const OBLIQUITY = 23.43928 * DEG;

function value(pair: [number, number], centuries: number): number {
	return pair[0] + pair[1] * centuries;
}

/** Heliocentric position in the J2000 ecliptic frame, in AU. */
function heliocentric(el: OrbitalElements, centuries: number): [number, number, number] {
	const a = value(el.a, centuries);
	const e = value(el.e, centuries);
	const i = value(el.i, centuries) * DEG;
	const l = value(el.l, centuries);
	const peri = value(el.peri, centuries);
	const node = value(el.node, centuries);

	const argPeri = (peri - node) * DEG;
	let meanAnomaly = ((((l - peri) % 360) + 540) % 360) - 180;
	meanAnomaly *= DEG;

	// Kepler's equation by Newton's method.
	let eccentric = meanAnomaly + e * Math.sin(meanAnomaly);
	for (let n = 0; n < 12; n++) {
		const delta =
			(eccentric - e * Math.sin(eccentric) - meanAnomaly) / (1 - e * Math.cos(eccentric));
		eccentric -= delta;
		if (Math.abs(delta) < 1e-12) break;
	}

	const xOrbit = a * (Math.cos(eccentric) - e);
	const yOrbit = a * Math.sqrt(1 - e * e) * Math.sin(eccentric);

	const cosW = Math.cos(argPeri);
	const sinW = Math.sin(argPeri);
	const cosN = Math.cos(node * DEG);
	const sinN = Math.sin(node * DEG);
	const cosI = Math.cos(i);
	const sinI = Math.sin(i);

	return [
		(cosW * cosN - sinW * sinN * cosI) * xOrbit + (-sinW * cosN - cosW * sinN * cosI) * yOrbit,
		(cosW * sinN + sinW * cosN * cosI) * xOrbit + (-sinW * sinN + cosW * cosN * cosI) * yOrbit,
		sinW * sinI * xOrbit + cosW * sinI * yOrbit
	];
}

/** Julian date from a UTC instant. */
export function julianDate(date: Date): number {
	return date.getTime() / 86400000 + 2440587.5;
}

/** Greenwich mean sidereal time in degrees. */
export function greenwichSiderealTime(date: Date): number {
	const jd = julianDate(date);
	const d = jd - 2451545.0;
	const t = d / 36525;
	const gmst =
		280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
	return ((gmst % 360) + 360) % 360;
}

/** Geocentric equatorial positions of the naked-eye planets. */
export function planetPositions(date: Date): SkyObject[] {
	const centuries = (julianDate(date) - 2451545.0) / 36525;
	const earth = heliocentric(EARTH, centuries);
	const out: SkyObject[] = [];

	for (const el of PLANETS) {
		const p = heliocentric(el, centuries);
		const dx = p[0] - earth[0];
		const dy = p[1] - earth[1];
		const dz = p[2] - earth[2];

		// Ecliptic to equatorial.
		const x = dx;
		const y = dy * Math.cos(OBLIQUITY) - dz * Math.sin(OBLIQUITY);
		const z = dy * Math.sin(OBLIQUITY) + dz * Math.cos(OBLIQUITY);

		const distance = Math.hypot(dx, dy, dz);
		const sunDistance = Math.hypot(p[0], p[1], p[2]);
		const earthSun = Math.hypot(earth[0], earth[1], earth[2]);

		// Phase angle at the planet, between the Sun and the Earth.
		const cosPhase = clamp(
			(sunDistance * sunDistance + distance * distance - earthSun * earthSun) /
				(2 * sunDistance * distance),
			-1,
			1
		);
		const phase = Math.acos(cosPhase) / DEG;

		const magnitude =
			el.absoluteMagnitude +
			5 * Math.log10(sunDistance * distance) +
			el.phase[0] * phase +
			el.phase[1] * phase * phase +
			el.phase[2] * phase * phase * phase;

		out.push({
			name: el.name,
			ra: ((Math.atan2(y, x) / DEG) % 360 + 360) % 360,
			dec: Math.asin(z / Math.hypot(x, y, z)) / DEG,
			magnitude,
			kind: 'planet'
		});
	}
	return out;
}

/** Bright stars, J2000 coordinates. Enough to make the sky recognisable. */
export const BRIGHT_STARS: SkyObject[] = (
	[
		['Sirius', 101.287, -16.716, -1.46],
		['Canopus', 95.988, -52.696, -0.74],
		['Arcturus', 213.915, 19.182, -0.05],
		['Vega', 279.234, 38.784, 0.03],
		['Capella', 79.172, 45.998, 0.08],
		['Rigel', 78.634, -8.202, 0.13],
		['Procyon', 114.825, 5.225, 0.34],
		['Betelgeuse', 88.793, 7.407, 0.5],
		['Achernar', 24.429, -57.237, 0.46],
		['Altair', 297.696, 8.868, 0.77],
		['Aldebaran', 68.98, 16.509, 0.85],
		['Antares', 247.352, -26.432, 1.09],
		['Spica', 201.298, -11.161, 0.97],
		['Pollux', 116.329, 28.026, 1.14],
		['Fomalhaut', 344.413, -29.622, 1.16],
		['Deneb', 310.358, 45.28, 1.25],
		['Regulus', 152.093, 11.967, 1.36],
		['Castor', 113.65, 31.888, 1.58],
		['Bellatrix', 81.283, 6.35, 1.64],
		['Elnath', 81.573, 28.608, 1.65],
		['Alnilam', 84.053, -1.202, 1.69],
		['Alioth', 193.507, 55.96, 1.76],
		['Dubhe', 165.932, 61.751, 1.79],
		['Mirfak', 51.081, 49.861, 1.79],
		['Wezen', 107.098, -26.393, 1.83],
		['Alkaid', 206.885, 49.313, 1.85],
		['Menkalinan', 89.882, 44.947, 1.9],
		['Atria', 252.166, -69.028, 1.91],
		['Alhena', 99.428, 16.399, 1.93],
		['Peacock', 306.412, -56.735, 1.94],
		['Polaris', 37.955, 89.264, 1.98],
		['Mizar', 200.981, 54.925, 2.23],
		['Denebola', 177.265, 14.572, 2.14],
		['Algieba', 154.993, 19.841, 2.08],
		['Merak', 165.46, 56.383, 2.37],
		['Phecda', 178.458, 53.695, 2.44],
		['Alphard', 141.897, -8.659, 1.98],
		['Rasalhague', 263.734, 12.56, 2.08],
		['Kochab', 222.676, 74.156, 2.08],
		['Eltanin', 269.152, 51.489, 2.23],
		['Alphecca', 233.672, 26.715, 2.22],
		['Sadr', 305.557, 40.257, 2.23],
		['Algol', 47.042, 40.956, 2.12],
		['Almach', 30.975, 42.33, 2.1],
		['Hamal', 31.793, 23.462, 2.0],
		['Diphda', 10.897, -17.987, 2.04],
		['Nunki', 283.816, -26.297, 2.05],
		['Alpheratz', 2.097, 29.09, 2.06],
		['Mirach', 17.433, 35.62, 2.06],
		['Izar', 221.247, 27.074, 2.37],
		['Zubeneschamali', 229.252, -9.383, 2.61],
		['Zosma', 168.527, 20.524, 2.56],
		['Talitha', 134.802, 48.042, 3.14],
		['Gienah', 183.952, -17.542, 2.59]
	] as Array<[string, number, number, number]>
).map(([name, ra, dec, magnitude]) => ({ name, ra, dec, magnitude, kind: 'star' as const }));

export interface HorizonPosition {
	altitude: number;
	azimuth: number;
}

/** Convert equatorial coordinates to the observer's horizon frame. */
export function toHorizon(
	object: { ra: number; dec: number },
	date: Date,
	lat: number,
	lon: number
): HorizonPosition {
	const lst = greenwichSiderealTime(date) + lon;
	const hourAngle = (lst - object.ra) * DEG;
	const dec = object.dec * DEG;
	const latitude = lat * DEG;

	const sinAlt =
		Math.sin(latitude) * Math.sin(dec) +
		Math.cos(latitude) * Math.cos(dec) * Math.cos(hourAngle);
	const altitude = Math.asin(clamp(sinAlt, -1, 1));
	const azimuth = Math.atan2(
		-Math.cos(dec) * Math.sin(hourAngle),
		Math.sin(dec) * Math.cos(latitude) - Math.cos(dec) * Math.sin(latitude) * Math.cos(hourAngle)
	);

	return {
		altitude: altitude / DEG,
		azimuth: ((azimuth / DEG) % 360 + 360) % 360
	};
}

/** Everything worth drawing, brightest first. */
export function visibleSkyObjects(date: Date): SkyObject[] {
	return [...planetPositions(date), ...BRIGHT_STARS].sort((a, b) => a.magnitude - b.magnitude);
}
