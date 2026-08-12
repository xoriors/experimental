/**
 * Finding somewhere to actually stand.
 *
 * Combines three things: where the Sun will be at the best visible moment for a
 * given spot, what OpenStreetMap knows about places you can drive to nearby,
 * and what the terrain does in that direction. The output is a ranked list of
 * places with an honest verdict on whether a hill is in the way.
 */

import { localCircumstances } from './local';
import {
	bearing,
	distanceM,
	horizonProfile,
	horizonSamplePoints,
	judgeView,
	SAMPLE_DISTANCES_M,
	type HorizonProfile,
	type Point,
	type ViewVerdict
} from './horizon';
import { elevationsFor } from '../data/elevation';
import { findSpots, type Spot, type SpotKind } from '../data/overpass';

export interface ScoredSpot {
	spot: Spot;
	/** Distance and direction from the place the user chose. */
	distanceM: number;
	bearingDeg: number;
	elevationM: number;
	/** Sun's position at the best visible moment, seen from this spot. */
	sunAltitudeDeg: number;
	sunAzimuthDeg: number;
	horizon: HorizonProfile;
	verdict: ViewVerdict;
	/** Local time of the moment being judged. */
	bestMoment: Date | null;
	obscuration: number;
	isTotal: boolean;
}

/** How many spots to evaluate. Each costs fifteen elevation samples. */
const MAX_SPOTS = 20;

const KIND_PRIORITY: Record<SpotKind, number> = {
	viewpoint: 0,
	rest: 1,
	picnic: 1,
	parking: 2,
	peak: 3,
	tower: 3
};

/** Keep a manageable, varied shortlist: viewpoints first, then roadside spots. */
function shortlist(spots: Spot[], origin: Point): Spot[] {
	return [...spots]
		.sort((a, b) => {
			const priority = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
			if (priority !== 0) return priority;
			return distanceM(origin, a) - distanceM(origin, b);
		})
		.slice(0, MAX_SPOTS);
}

export interface ViewpointSearch {
	origin: ScoredSpot | null;
	spots: ScoredSpot[];
	/** Number of candidates OpenStreetMap returned before shortlisting. */
	found: number;
}

export interface ProgressReport {
	stage: 'searching' | 'terrain' | 'done';
	message: string;
}

/**
 * Rank places near `origin` by whether the setting Sun will clear the terrain.
 * `onProgress` is called as the two services are consulted, because the whole
 * thing takes a few seconds.
 */
export async function findViewpoints(
	origin: Point,
	radiusM: number,
	options: { signal?: AbortSignal; onProgress?: (report: ProgressReport) => void } = {}
): Promise<ViewpointSearch> {
	const { signal, onProgress } = options;

	onProgress?.({ stage: 'searching', message: 'Looking for places you can drive to…' });
	const found = await findSpots(origin, radiusM, signal);
	const candidates = shortlist(found, origin);

	// The starting point is worth judging too — you may not need to move at all.
	const originSpot: Spot = {
		id: 'origin',
		name: 'Where you are now',
		kind: 'viewpoint',
		lat: origin.lat,
		lon: origin.lon,
		drivable: true
	};
	const all = [originSpot, ...candidates];

	onProgress?.({
		stage: 'terrain',
		message: `Checking the horizon at ${all.length} places…`
	});

	// One elevation request covers the spot itself plus its skyline samples.
	const requests: Point[] = [];
	const sunDirections: number[] = [];
	for (const spot of all) {
		const local = localCircumstances({ lat: spot.lat, lon: spot.lon });
		const moment = local.bestVisible ?? local.max;
		sunDirections.push(moment.azimuth);
		requests.push({ lat: spot.lat, lon: spot.lon });
		requests.push(...horizonSamplePoints(spot, moment.azimuth));
	}

	const elevations = await elevationsFor(requests, signal);

	const stride = 1 + SAMPLE_DISTANCES_M.length;
	const scored: ScoredSpot[] = all.map((spot, index) => {
		const base = index * stride;
		const local = localCircumstances({ lat: spot.lat, lon: spot.lon });
		const moment = local.bestVisible ?? local.max;
		const measured = elevations[base];
		const elevationM = Number.isFinite(measured)
			? measured
			: (spot.taggedElevationM ?? 0);
		const profile = horizonProfile(elevationM, elevations.slice(base + 1, base + stride));
		return {
			spot,
			distanceM: distanceM(origin, spot),
			bearingDeg: bearing(origin, spot),
			elevationM,
			sunAltitudeDeg: moment.altitude,
			sunAzimuthDeg: sunDirections[index],
			horizon: profile,
			verdict: judgeView(moment.altitude, profile.angle),
			bestMoment: local.hasEclipse && !local.belowHorizon ? moment.time : null,
			obscuration: local.visibleObscuration,
			isTotal: local.isTotal
		};
	});

	onProgress?.({ stage: 'done', message: '' });

	const [originScored, ...rest] = scored;
	rest.sort((a, b) => {
		// Best view first; break ties by putting the nearer one first.
		const byClearance = b.verdict.clearanceDeg - a.verdict.clearanceDeg;
		if (Math.abs(byClearance) > 0.25) return byClearance;
		return a.distanceM - b.distanceM;
	});

	return { origin: originScored ?? null, spots: rest, found: found.length };
}

/* ------------------------------------------------------------------ *
 * Google Maps links. All use the documented URL scheme, so no key and
 * nothing to load — they simply open the app or the site.
 * ------------------------------------------------------------------ */

export function mapsPlaceUrl(point: Point): string {
	return `https://www.google.com/maps/search/?api=1&query=${point.lat.toFixed(6)},${point.lon.toFixed(6)}`;
}

export function mapsDirectionsUrl(point: Point): string {
	return `https://www.google.com/maps/dir/?api=1&destination=${point.lat.toFixed(6)},${point.lon.toFixed(6)}&travelmode=driving`;
}

/**
 * Street View looking along the given bearing — the quickest way to see for
 * yourself whether there is a hedge, a barn or a ridge in the way.
 */
export function streetViewUrl(point: Point, headingDeg: number): string {
	const heading = Math.round(((headingDeg % 360) + 360) % 360);
	return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point.lat.toFixed(6)},${point.lon.toFixed(6)}&heading=${heading}&pitch=5&fov=90`;
}
