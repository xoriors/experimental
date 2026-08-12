/**
 * Will the terrain get in the way?
 *
 * With the Sun only a few degrees up at totality, the deciding factor for a
 * viewing spot is not the sky but the ground: a ridge 5 km away that rises 400 m
 * blocks everything below about 4.5 degrees, which is the whole eclipse from
 * Valencia. This works out the elevation angle of the skyline in the direction
 * the Sun will be, so a spot can be judged before driving to it.
 */

const DEG = Math.PI / 180;
const EARTH_RADIUS_M = 6371008.8;

/**
 * Effective Earth radius allowing for standard atmospheric refraction, which
 * bends light down and lets you see slightly further than geometry alone
 * suggests. The usual 7/6 factor.
 */
const REFRACTED_RADIUS_M = EARTH_RADIUS_M * (7 / 6);

export interface Point {
	lat: number;
	lon: number;
}

/** Point reached by travelling `distanceM` from `from` along a given bearing. */
export function destination(from: Point, bearingDeg: number, distanceM: number): Point {
	const delta = distanceM / EARTH_RADIUS_M;
	const theta = bearingDeg * DEG;
	const phi1 = from.lat * DEG;
	const lambda1 = from.lon * DEG;

	const sinPhi2 =
		Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
	const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)));
	const lambda2 =
		lambda1 +
		Math.atan2(
			Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
			Math.cos(delta) - Math.sin(phi1) * sinPhi2
		);

	return { lat: phi2 / DEG, lon: ((((lambda2 / DEG) + 540) % 360) - 180) };
}

/** Great-circle distance in metres. */
export function distanceM(a: Point, b: Point): number {
	const dPhi = (b.lat - a.lat) * DEG;
	const dLambda = (b.lon - a.lon) * DEG;
	const h =
		Math.sin(dPhi / 2) ** 2 +
		Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLambda / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north. */
export function bearing(a: Point, b: Point): number {
	const phi1 = a.lat * DEG;
	const phi2 = b.lat * DEG;
	const dLambda = (b.lon - a.lon) * DEG;
	const y = Math.sin(dLambda) * Math.cos(phi2);
	const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
	return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}

/**
 * Distances at which to sample the terrain, in metres. Spaced roughly
 * logarithmically because near obstacles dominate: a 50 m rise at 500 m blocks
 * 5.7 degrees, while the same rise at 20 km blocks 0.14 and is below the
 * curvature drop anyway.
 */
export const SAMPLE_DISTANCES_M = [
	150, 300, 500, 800, 1200, 1800, 2600, 3800, 5500, 8000, 11500, 16500, 24000, 34000
];

/** The points whose ground height decides the skyline in a given direction. */
export function horizonSamplePoints(from: Point, bearingDeg: number): Point[] {
	return SAMPLE_DISTANCES_M.map((d) => destination(from, bearingDeg, d));
}

export interface HorizonProfile {
	/** Elevation angle of the highest obstruction, degrees. Negative if the
	 *  ground falls away and the true horizon dips below level. */
	angle: number;
	/** Distance to whatever sets that angle, metres. */
	atDistanceM: number;
	/** Per-sample elevation angles, for drawing a profile. */
	samples: Array<{ distanceM: number; elevationM: number; angle: number }>;
}

/**
 * Skyline angle from an observer, given ground elevations already sampled along
 * the bearing at `SAMPLE_DISTANCES_M`.
 */
export function horizonProfile(
	observerElevationM: number,
	elevations: number[],
	eyeHeightM = 1.6
): HorizonProfile {
	const eye = observerElevationM + eyeHeightM;
	let angle = -90;
	let atDistanceM = 0;
	const samples: HorizonProfile['samples'] = [];

	for (let i = 0; i < elevations.length && i < SAMPLE_DISTANCES_M.length; i++) {
		const d = SAMPLE_DISTANCES_M[i];
		const e = elevations[i];
		if (!Number.isFinite(e)) continue;
		// Distant ground curves away, so subtract the drop before taking the angle.
		const drop = (d * d) / (2 * REFRACTED_RADIUS_M);
		const sampleAngle = Math.atan2(e - eye - drop, d) / DEG;
		samples.push({ distanceM: d, elevationM: e, angle: sampleAngle });
		if (sampleAngle > angle) {
			angle = sampleAngle;
			atDistanceM = d;
		}
	}

	if (!samples.length) return { angle: 0, atDistanceM: 0, samples };
	return { angle, atDistanceM, samples };
}

export type ViewQuality = 'clear' | 'likely' | 'marginal' | 'blocked';

export interface ViewVerdict {
	quality: ViewQuality;
	/** How far above the skyline the Sun sits, in degrees. */
	clearanceDeg: number;
	label: string;
}

/**
 * Compare the skyline with where the Sun will actually be. The margins are
 * generous because a 90 m elevation model cannot see hedges, buildings or a
 * line of poplars, so anything close to the line needs checking on the ground.
 */
export function judgeView(sunAltitudeDeg: number, horizonAngleDeg: number): ViewVerdict {
	const clearanceDeg = sunAltitudeDeg - horizonAngleDeg;
	if (clearanceDeg >= 3) return { quality: 'clear', clearanceDeg, label: 'Clear view' };
	if (clearanceDeg >= 1) return { quality: 'likely', clearanceDeg, label: 'Probably clear' };
	if (clearanceDeg >= 0) return { quality: 'marginal', clearanceDeg, label: 'Marginal' };
	return { quality: 'blocked', clearanceDeg, label: 'Terrain in the way' };
}

/** Compass point for a bearing, for describing which way to drive. */
export function compassPoint(bearingDeg: number): string {
	const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
	return points[Math.round((((bearingDeg % 360) + 360) % 360) / 22.5) % 16];
}
