/**
 * Besselian elements and geometry for the total solar eclipse of 2026 August 12.
 *
 * Everything the site shows — contact times, magnitude, obscuration, the shape of
 * the umbra on the ground, where the Moon sits on the Sun's disk — is derived from
 * the polynomial elements below rather than from canned tables, so any point on
 * Earth can be evaluated at any instant.
 *
 * Elements: NASA/GSFC Five Millennium Canon of Solar Eclipses (Espenak & Meeus),
 * https://eclipse.gsfc.nasa.gov/SEsearch/SEdata.php?Ecl=20260812
 * Method: Explanatory Supplement to the Astronomical Almanac, ch. 8;
 * Meeus, "Elements of Solar Eclipses 1951-2200".
 */

export const DEG = Math.PI / 180;

/** Coefficients a0..a3 of a Besselian element, evaluated in decimal hours from t0. */
type Poly = readonly [number, number, number, number];

export const ELEMENTS = {
	/** Reference instant: 2026 August 12, 18:00:00 TDT. */
	t0Hours: 18,
	x: [0.4755140, 0.5189249, -0.0000773, -0.0000080] as Poly,
	y: [0.7711830, -0.2301680, -0.0001246, 0.0000038] as Poly,
	/** Declination of the shadow axis, degrees. */
	d: [14.7966700, -0.0120650, -0.0000030, 0.0] as Poly,
	/** Radius of the penumbra on the fundamental plane, Earth equatorial radii. */
	l1: [0.5379550, 0.0000939, -0.0000121, 0.0] as Poly,
	/** Radius of the umbra on the fundamental plane; negative means a total eclipse. */
	l2: [-0.0081420, 0.0000935, -0.0000121, 0.0] as Poly,
	/** Greenwich hour angle of the shadow axis, degrees. */
	mu: [88.747787, 15.003090, 0.0, 0.0] as Poly,
	tanF1: 0.0046141,
	tanF2: 0.0045911
} as const;

/**
 * TT - UT, in seconds, as adopted by NASA for this eclipse's predictions. Using
 * their value keeps our computed UTC times consistent with the published ones.
 */
export const DELTA_T_SECONDS = 75.4;

/** The reading "2026-08-12T18:00:00" interpreted on the TT scale, as epoch ms. */
const T0_TT_MS = Date.UTC(2026, 7, 12, 18, 0, 0);

/**
 * The tabulated hour angle mu is measured from the *ephemeris meridian*, which
 * sits 1.002738*deltaT of rotation east of Greenwich, because the elements are a
 * function of TT while Earth's rotation follows UT. Subtracting this puts mu back
 * on the Greenwich meridian so that ordinary longitudes can be used.
 */
export const EPHEMERIS_MERIDIAN_DEG = (1.002738 * DELTA_T_SECONDS * 15) / 3600;

/** Instant of greatest eclipse (UTC), for orientation and default views. */
export const GREATEST_ECLIPSE_UTC = new Date(Date.UTC(2026, 7, 12, 17, 45, 51));

/** Earth's flattening constants (WGS84 / IAU 1976 are identical at this precision). */
const B_OVER_A = 0.99664719;
const E2 = 1 - B_OVER_A * B_OVER_A; // first eccentricity squared, 0.00669438
export const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;

/** Moon radius / Earth equatorial radius, the IAU value used in eclipse work. */
export const K_MOON = 0.2725076;

function poly(c: Poly, t: number): number {
	return c[0] + t * (c[1] + t * (c[2] + t * c[3]));
}

function polyDerivative(c: Poly, t: number): number {
	return c[1] + t * (2 * c[2] + t * 3 * c[3]);
}

/** Convert a UTC instant to `t`, decimal hours from the elements' reference epoch. */
export function utcToT(date: Date): number {
	return (date.getTime() + DELTA_T_SECONDS * 1000 - T0_TT_MS) / 3_600_000;
}

/** Convert `t` (decimal hours from the reference epoch) back to a UTC instant. */
export function tToUtc(t: number): Date {
	return new Date(T0_TT_MS + t * 3_600_000 - DELTA_T_SECONDS * 1000);
}

export interface Elements {
	t: number;
	x: number;
	y: number;
	/** Declination of the shadow axis, radians. */
	d: number;
	l1: number;
	l2: number;
	/** Greenwich hour angle of the shadow axis, radians. */
	mu: number;
	dx: number;
	dy: number;
	/** radians per hour */
	dd: number;
	/** radians per hour */
	dmu: number;
}

export function elementsAt(t: number): Elements {
	return {
		t,
		x: poly(ELEMENTS.x, t),
		y: poly(ELEMENTS.y, t),
		d: poly(ELEMENTS.d, t) * DEG,
		l1: poly(ELEMENTS.l1, t),
		l2: poly(ELEMENTS.l2, t),
		mu: (poly(ELEMENTS.mu, t) - EPHEMERIS_MERIDIAN_DEG) * DEG,
		dx: polyDerivative(ELEMENTS.x, t),
		dy: polyDerivative(ELEMENTS.y, t),
		dd: polyDerivative(ELEMENTS.d, t) * DEG,
		dmu: polyDerivative(ELEMENTS.mu, t) * DEG
	};
}

export interface Observer {
	/** Geodetic latitude, degrees north. */
	lat: number;
	/** Longitude, degrees east. */
	lon: number;
	/** Height above the ellipsoid, metres. */
	elevation?: number;
}

/** Geocentric rho*sin(phi') and rho*cos(phi') for an observer on the ellipsoid. */
export function geocentricCoords(obs: Observer): { rhoSin: number; rhoCos: number } {
	const lat = obs.lat * DEG;
	const u = Math.atan(B_OVER_A * Math.tan(lat));
	const h = (obs.elevation ?? 0) / (EARTH_EQUATORIAL_RADIUS_KM * 1000);
	return {
		rhoSin: B_OVER_A * Math.sin(u) + h * Math.sin(lat),
		rhoCos: Math.cos(u) + h * Math.cos(lat)
	};
}

/** The observer's instantaneous position relative to the shadow axis. */
export interface ShadowGeometry {
	t: number;
	/** Offset of the shadow axis from the observer in the fundamental plane. */
	u: number;
	v: number;
	du: number;
	dv: number;
	/** Separation of axis and observer, Earth radii. */
	m: number;
	/** Penumbral radius at the observer's distance from the fundamental plane. */
	l1: number;
	/** Umbral radius at the observer; negative during totality. */
	l2: number;
	/** Observer's height above the fundamental plane, Earth radii. */
	zeta: number;
	/** Local hour angle of the shadow axis, radians. */
	theta: number;
	/** Declination of the shadow axis, radians. */
	d: number;
}

export function shadowGeometry(t: number, obs: Observer): ShadowGeometry {
	const e = elementsAt(t);
	const { rhoSin, rhoCos } = geocentricCoords(obs);

	const theta = e.mu + obs.lon * DEG;
	const sinTheta = Math.sin(theta);
	const cosTheta = Math.cos(theta);
	const sinD = Math.sin(e.d);
	const cosD = Math.cos(e.d);

	const xi = rhoCos * sinTheta;
	const eta = rhoSin * cosD - rhoCos * cosTheta * sinD;
	const zeta = rhoSin * sinD + rhoCos * cosTheta * cosD;

	const dXi = e.dmu * rhoCos * cosTheta;
	const dEta = e.dmu * xi * sinD - zeta * e.dd;

	const u = e.x - xi;
	const v = e.y - eta;

	return {
		t,
		u,
		v,
		du: e.dx - dXi,
		dv: e.dy - dEta,
		m: Math.hypot(u, v),
		l1: e.l1 - zeta * ELEMENTS.tanF1,
		l2: e.l2 - zeta * ELEMENTS.tanF2,
		zeta,
		theta,
		d: e.d
	};
}

/**
 * Fraction of the Sun's *area* hidden by the Moon. This is what determines how
 * dark it gets — quite different from the eclipse magnitude, which compares
 * diameters and is the number usually quoted.
 */
export function obscuration(g: ShadowGeometry): number {
	// In Besselian units the Sun's radius is (l1+l2)/2 and the Moon's is (l1-l2)/2.
	const rs = (g.l1 + g.l2) / 2;
	const rm = (g.l1 - g.l2) / 2;
	const dist = g.m;

	if (dist >= rs + rm) return 0;
	if (dist <= rm - rs) return 1;
	if (dist <= rs - rm) return (rm * rm) / (rs * rs);

	// Area of intersection of two circles.
	const a1 = Math.acos(clamp((dist * dist + rs * rs - rm * rm) / (2 * dist * rs), -1, 1));
	const a2 = Math.acos(clamp((dist * dist + rm * rm - rs * rs) / (2 * dist * rm), -1, 1));
	const triangle =
		0.5 *
		Math.sqrt(
			Math.max(0, (-dist + rs + rm) * (dist + rs - rm) * (dist - rs + rm) * (dist + rs + rm))
		);
	const area = rs * rs * a1 + rm * rm * a2 - triangle;
	return clamp(area / (Math.PI * rs * rs), 0, 1);
}

/**
 * Eclipse magnitude: the fraction of the Sun's *diameter* covered by the Moon.
 * Values above 1 mean the Moon's disc more than spans the Sun's.
 */
export function magnitude(g: ShadowGeometry): number {
	const denominator = g.l1 + g.l2;
	if (Math.abs(denominator) < 1e-12) return 0;
	return (g.l1 - g.m) / denominator;
}

/**
 * Ratio of the Moon's apparent diameter to the Sun's. This is the number NASA
 * quotes as "eclipse magnitude" for a central eclipse, and it is what decides
 * whether an eclipse is total or annular, so it is worth reporting separately
 * from the magnitude above.
 */
export function diameterRatio(g: ShadowGeometry): number {
	const denominator = g.l1 + g.l2;
	if (Math.abs(denominator) < 1e-12) return 0;
	return (g.l1 - g.l2) / denominator;
}

export function clamp(value: number, lo: number, hi: number): number {
	return value < lo ? lo : value > hi ? hi : value;
}

/* ------------------------------------------------------------------ *
 * Projecting the shadow axis onto the Earth
 * ------------------------------------------------------------------ */

/**
 * Unit vectors of the Besselian fundamental plane expressed in Earth-fixed
 * coordinates (X towards lon 0 on the equator, Y towards 90E, Z towards the pole).
 */
function fundamentalBasis(d: number, mu: number) {
	const sinD = Math.sin(d);
	const cosD = Math.cos(d);
	const sinMu = Math.sin(mu);
	const cosMu = Math.cos(mu);
	return {
		// towards the observer's east at the sub-axis point
		xiHat: [sinMu, cosMu, 0] as const,
		// towards celestial north
		etaHat: [-sinD * cosMu, sinD * sinMu, cosD] as const,
		// along the axis, towards the Sun
		zetaHat: [cosD * cosMu, -cosD * sinMu, sinD] as const
	};
}

export interface SurfacePoint {
	lat: number;
	lon: number;
	/** Height of the surface point above the fundamental plane, Earth radii. */
	zeta: number;
}

/**
 * Where does the line through fundamental-plane point (x, y), parallel to the
 * shadow axis, meet the Earth's surface? Returns null when it misses the globe.
 */
export function projectToEarth(x: number, y: number, d: number, mu: number): SurfacePoint | null {
	const { xiHat, etaHat, zetaHat } = fundamentalBasis(d, mu);

	// Point on the plane, in Earth-fixed coordinates (units of equatorial radii).
	const p = [
		x * xiHat[0] + y * etaHat[0],
		x * xiHat[1] + y * etaHat[1],
		x * xiHat[2] + y * etaHat[2]
	];

	// Solve |P + zeta*zetaHat| on the ellipsoid: X^2 + Y^2 + Z^2/(1-e^2) = 1.
	const w = [1, 1, 1 / (1 - E2)];
	let a = 0;
	let b = 0;
	let c = -1;
	for (let i = 0; i < 3; i++) {
		a += w[i] * zetaHat[i] * zetaHat[i];
		b += 2 * w[i] * p[i] * zetaHat[i];
		c += w[i] * p[i] * p[i];
	}
	const disc = b * b - 4 * a * c;
	if (disc < 0) return null;

	// The larger root is the sunward side of the Earth.
	const zeta = (-b + Math.sqrt(disc)) / (2 * a);
	const point = [p[0] + zeta * zetaHat[0], p[1] + zeta * zetaHat[1], p[2] + zeta * zetaHat[2]];

	const lon = Math.atan2(point[1], point[0]) / DEG;
	const lat = Math.atan2(point[2] / (1 - E2), Math.hypot(point[0], point[1])) / DEG;
	return { lat, lon, zeta };
}

/** The point where the shadow axis meets the Earth at time `t` (the centre line). */
export function centralLinePoint(t: number): SurfacePoint | null {
	const e = elementsAt(t);
	return projectToEarth(e.x, e.y, e.d, e.mu);
}

/**
 * Outline of the umbra on the Earth's surface at time `t`, as a ring of lon/lat
 * points. The umbral radius depends on how far the ground is from the fundamental
 * plane, so each direction is solved by a short fixed-point iteration.
 *
 * Returns null if the umbra is entirely off the globe; when the umbra straddles
 * the terminator some directions have no solution and are simply dropped.
 */
export function umbraOutline(t: number, steps = 120): Array<[number, number]> | null {
	return shadowOutline(t, steps, 'umbra');
}

/**
 * Outline of the penumbra — the edge of the region seeing any eclipse at all.
 * Most of it usually falls off the globe, so the ring is normally partial.
 */
export function penumbraOutline(t: number, steps = 120): Array<[number, number]> | null {
	return shadowOutline(t, steps, 'penumbra');
}

function shadowOutline(
	t: number,
	steps: number,
	which: 'umbra' | 'penumbra'
): Array<[number, number]> | null {
	const e = elementsAt(t);
	const l = which === 'umbra' ? e.l2 : e.l1;
	const tanF = which === 'umbra' ? ELEMENTS.tanF2 : ELEMENTS.tanF1;
	const ring: Array<[number, number]> = [];

	for (let i = 0; i < steps; i++) {
		const angle = (i / steps) * 2 * Math.PI;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);

		let radius = Math.abs(l);
		let point: SurfacePoint | null = null;
		for (let iter = 0; iter < 8; iter++) {
			point = projectToEarth(e.x + radius * cos, e.y + radius * sin, e.d, e.mu);
			if (!point) break;
			const next = Math.abs(l - point.zeta * tanF);
			if (Math.abs(next - radius) < 1e-9) {
				radius = next;
				break;
			}
			radius = next;
		}
		if (point) ring.push([point.lon, point.lat]);
	}

	return ring.length >= 3 ? ring : null;
}

/**
 * Northern and southern edges of the path of totality at time `t`. The limits are
 * the points on the umbral circle whose boundary runs parallel to the shadow's
 * motion, i.e. at right angles to the velocity of the shadow centre.
 */
export function pathLimits(t: number): { north: SurfacePoint; south: SurfacePoint } | null {
	const e = elementsAt(t);
	const heading = Math.atan2(e.dy, e.dx);
	const out: SurfacePoint[] = [];

	for (const sign of [1, -1]) {
		const angle = heading + (sign * Math.PI) / 2;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		let radius = Math.abs(e.l2);
		let point: SurfacePoint | null = null;
		for (let iter = 0; iter < 8; iter++) {
			point = projectToEarth(e.x + radius * cos, e.y + radius * sin, e.d, e.mu);
			if (!point) break;
			radius = Math.abs(e.l2 - point.zeta * ELEMENTS.tanF2);
		}
		if (!point) return null;
		out.push(point);
	}

	return out[0].lat >= out[1].lat
		? { north: out[0], south: out[1] }
		: { north: out[1], south: out[0] };
}
