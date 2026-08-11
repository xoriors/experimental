/**
 * Local circumstances: what a specific observer at a specific place sees, and
 * where exactly the Moon sits on the Sun as they look at it.
 */

import {
	DEG,
	clamp,
	diameterRatio,
	elementsAt,
	magnitude,
	obscuration,
	projectToEarth,
	shadowGeometry,
	tToUtc,
	utcToT,
	type Observer,
	type ShadowGeometry
} from './besselian';

export type ContactName = 'C1' | 'C2' | 'C3' | 'C4';

export interface LocalCircumstances {
	observer: Observer;
	/** True when the observer is inside the path of totality. */
	isTotal: boolean;
	/** True when any part of the Sun is covered at some point. */
	hasEclipse: boolean;
	/** True when the Sun is below the horizon for the whole eclipse. */
	belowHorizon: boolean;
	/** First contact: the Moon touches the Sun's edge. */
	c1: ContactInfo | null;
	/** Second contact: totality begins. */
	c2: ContactInfo | null;
	/** Maximum eclipse. */
	max: ContactInfo;
	/** Third contact: totality ends. */
	c3: ContactInfo | null;
	/** Fourth contact: the Moon leaves the Sun. */
	c4: ContactInfo | null;
	/** Length of totality in seconds, 0 outside the path. */
	totalitySeconds: number;
	/** Length of the whole eclipse in seconds. */
	durationSeconds: number;
	/** Greatest eclipse magnitude (fraction of the Sun's diameter). */
	maxMagnitude: number;
	/** Greatest fraction of the Sun's area hidden. */
	maxObscuration: number;
	/** Moon's apparent diameter divided by the Sun's, at maximum. */
	diameterRatio: number;
}

export interface ContactInfo {
	time: Date;
	/** Decimal hours from the elements epoch. */
	t: number;
	/** Sun's geometric altitude in degrees; negative means below the horizon. */
	altitude: number;
	/** Sun's azimuth in degrees, measured from north through east. */
	azimuth: number;
	magnitude: number;
	obscuration: number;
	/** Position angle of the contact point, degrees east of celestial north. */
	positionAngle: number;
}

const MAX_ITERATIONS = 60;
const CONVERGENCE_HOURS = 1e-9;

/** Sun's altitude and azimuth from the shadow geometry, in degrees. */
export function sunPosition(g: ShadowGeometry, obs: Observer): { altitude: number; azimuth: number } {
	const lat = obs.lat * DEG;
	const sinAlt =
		Math.sin(lat) * Math.sin(g.d) + Math.cos(lat) * Math.cos(g.d) * Math.cos(g.theta);
	const altitude = Math.asin(clamp(sinAlt, -1, 1));
	const azimuth = Math.atan2(
		-Math.cos(g.d) * Math.sin(g.theta),
		Math.sin(g.d) * Math.cos(lat) - Math.cos(g.d) * Math.sin(lat) * Math.cos(g.theta)
	);
	return {
		altitude: altitude / DEG,
		azimuth: ((azimuth / DEG) % 360 + 360) % 360
	};
}

/**
 * Atmospheric refraction in degrees for a geometric altitude, Bennett's formula.
 * Worth applying here: from Spain the Sun is only a few degrees up during
 * totality, where refraction lifts it by a third of its own diameter.
 */
export function refraction(altitudeDeg: number): number {
	if (altitudeDeg < -2) return 0;
	const h = Math.max(altitudeDeg, -0.5);
	return 1 / Math.tan((h + 7.31 / (h + 4.4)) * DEG) / 60;
}

/**
 * Parallactic angle: the position angle of the zenith as seen at the Sun. This is
 * what turns "the Moon is north-east of the Sun" into "the bite is at 2 o'clock".
 */
export function parallacticAngle(g: ShadowGeometry, obs: Observer): number {
	const lat = obs.lat * DEG;
	return Math.atan2(
		Math.sin(g.theta),
		Math.tan(lat) * Math.cos(g.d) - Math.sin(g.d) * Math.cos(g.theta)
	);
}

/** Earth-Sun distance in AU, low-precision solar theory (good to ~1e-5 AU). */
export function sunDistanceAu(t: number): number {
	const jd = 2461265.25 + (t - 18) / 24; // 2026-08-12 18:00 TT
	const n = jd - 2451545.0;
	const g = (357.529 + 0.98560028 * n) * DEG;
	return 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
}

/** Sun's apparent angular radius in degrees. */
export function sunAngularRadius(t: number): number {
	return 959.63 / sunDistanceAu(t) / 3600;
}

export interface SkyGeometry {
	/** Sun's angular radius, degrees. */
	sunRadius: number;
	/** Moon's angular radius, degrees. */
	moonRadius: number;
	/** Angular separation of the two centres, degrees. */
	separation: number;
	/** Offset of the Moon's centre from the Sun's, in the observer's view. */
	offsetRight: number;
	offsetUp: number;
	altitude: number;
	azimuth: number;
	obscuration: number;
	magnitude: number;
	parallactic: number;
}

/**
 * Full sky-view geometry for the simulator: how big each disc is and where the
 * Moon sits relative to the Sun with the horizon the right way up.
 */
export function skyGeometry(t: number, obs: Observer): SkyGeometry {
	const g = shadowGeometry(t, obs);
	const sunRadius = sunAngularRadius(t);

	// l1 scales with (rSun + rMoon) and l2 with (rSun - rMoon), which pins the
	// Moon's apparent size relative to the Sun's without a lunar ephemeris.
	const ratio = (g.l1 - g.l2) / (g.l1 + g.l2);
	const moonRadius = sunRadius * ratio;

	// m is the centre separation in units where l1 equals the sum of the radii.
	const scale = (sunRadius + moonRadius) / g.l1;
	const offsetEast = g.u * scale;
	const offsetNorth = g.v * scale;

	const q = parallacticAngle(g, obs);
	const sinQ = Math.sin(q);
	const cosQ = Math.cos(q);

	const { altitude, azimuth } = sunPosition(g, obs);

	return {
		sunRadius,
		moonRadius,
		separation: g.m * scale,
		// Rotate the celestial (north, east) offset into the observer's
		// (up, right) frame. Celestial east is to the left when north is up.
		offsetRight: offsetNorth * sinQ - offsetEast * cosQ,
		offsetUp: offsetNorth * cosQ + offsetEast * sinQ,
		altitude,
		azimuth,
		obscuration: obscuration(g),
		magnitude: magnitude(g),
		parallactic: q / DEG
	};
}

/** Time of maximum eclipse for the observer, in decimal hours from the epoch. */
export function timeOfMaximum(obs: Observer, guess = 0): number {
	let t = guess;
	for (let i = 0; i < MAX_ITERATIONS; i++) {
		const g = shadowGeometry(t, obs);
		const n2 = g.du * g.du + g.dv * g.dv;
		if (n2 === 0) break;
		const tau = -(g.u * g.du + g.v * g.dv) / n2;
		t += tau;
		if (Math.abs(tau) < CONVERGENCE_HOURS) break;
	}
	return t;
}

/**
 * Solve for a contact time. `outer` selects the penumbral radius (C1/C4) rather
 * than the umbral one (C2/C3); `late` picks the closing contact of the pair.
 */
function solveContact(obs: Observer, start: number, outer: boolean, late: boolean): number | null {
	let t = start;
	for (let i = 0; i < MAX_ITERATIONS; i++) {
		const g = shadowGeometry(t, obs);
		const n = Math.hypot(g.du, g.dv);
		if (n === 0) return null;
		const radius = outer ? g.l1 : Math.abs(g.l2);
		const perpendicular = (g.u * g.dv - g.v * g.du) / n;
		const disc = radius * radius - perpendicular * perpendicular;
		if (disc < 0) return null;
		const tau =
			(late ? 1 : -1) * (Math.sqrt(disc) / n) - (g.u * g.du + g.v * g.dv) / (n * n);
		t += tau;
		if (Math.abs(tau) < CONVERGENCE_HOURS) return t;
		if (!Number.isFinite(t) || Math.abs(t) > 12) return null;
	}
	return Number.isFinite(t) ? t : null;
}

function contactInfo(t: number, obs: Observer): ContactInfo {
	const g = shadowGeometry(t, obs);
	const { altitude, azimuth } = sunPosition(g, obs);
	return {
		time: tToUtc(t),
		t,
		altitude,
		azimuth,
		magnitude: magnitude(g),
		obscuration: obscuration(g),
		positionAngle: ((Math.atan2(g.u, g.v) / DEG) % 360 + 360) % 360
	};
}

/** Everything an observer at `obs` needs to know about their own eclipse. */
export function localCircumstances(obs: Observer): LocalCircumstances {
	const tMax = timeOfMaximum(obs);
	const gMax = shadowGeometry(tMax, obs);
	const max = contactInfo(tMax, obs);

	const maxMagnitude = magnitude(gMax);
	const hasEclipse = maxMagnitude > 0;
	const isTotal = gMax.m < Math.abs(gMax.l2) && gMax.l2 < 0;

	const c1t = hasEclipse ? solveContact(obs, tMax, true, false) : null;
	const c4t = hasEclipse ? solveContact(obs, tMax, true, true) : null;
	const c2t = isTotal ? solveContact(obs, tMax, false, false) : null;
	const c3t = isTotal ? solveContact(obs, tMax, false, true) : null;

	const c1 = c1t !== null ? contactInfo(c1t, obs) : null;
	const c2 = c2t !== null ? contactInfo(c2t, obs) : null;
	const c3 = c3t !== null ? contactInfo(c3t, obs) : null;
	const c4 = c4t !== null ? contactInfo(c4t, obs) : null;

	// The Sun has to be up for any of this to be visible.
	const altitudes = [c1, max, c4].filter(Boolean).map((c) => c!.altitude);
	const belowHorizon = altitudes.length > 0 && altitudes.every((a) => a < -0.9);

	return {
		observer: obs,
		isTotal,
		hasEclipse,
		belowHorizon,
		c1,
		c2,
		max,
		c3,
		c4,
		totalitySeconds: c2t !== null && c3t !== null ? (c3t - c2t) * 3600 : 0,
		durationSeconds: c1t !== null && c4t !== null ? (c4t - c1t) * 3600 : 0,
		maxMagnitude,
		maxObscuration: obscuration(gMax),
		diameterRatio: diameterRatio(gMax)
	};
}

/** Convenience wrapper taking a UTC instant instead of element hours. */
export function circumstancesAtInstant(date: Date, obs: Observer) {
	return skyGeometry(utcToT(date), obs);
}

/**
 * Speed of the umbra across the ground, km/s — the number that explains why
 * totality is so short. Derived from how far the centre line moves in 10 seconds.
 */
export function shadowSpeedKmPerSec(t: number): number | null {
	const dt = 10 / 3600;
	const a = centralPoint(t - dt / 2);
	const b = centralPoint(t + dt / 2);
	if (!a || !b) return null;
	return haversineKm(a, b) / 10;
}

function centralPoint(t: number) {
	const e = elementsAt(t);
	return projectToEarth(e.x, e.y, e.d, e.mu);
}

export function haversineKm(
	a: { lat: number; lon: number },
	b: { lat: number; lon: number }
): number {
	const R = 6371.0088;
	const dLat = (b.lat - a.lat) * DEG;
	const dLon = (b.lon - a.lon) * DEG;
	const s =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
