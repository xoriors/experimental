import * as PathFinderMod from 'geojson-path-finder';

type PathFinderCtor = new (
	network: FeatureCollection<LineString>
) => {
	findPath(a: Feature<Point>, b: Feature<Point>): { path: Position[]; weight: number } | undefined;
};

// geojson-path-finder ships a CJS `exports.default = PathFinder` build. Under
// Vercel's Node.js bundler the default import sometimes resolves to the whole
// module namespace, so `new PathFinder(...)` throws "not a constructor". Pick
// the default off whichever shape we get.
const PathFinder = ((PathFinderMod as unknown as { default?: PathFinderCtor }).default ??
	(PathFinderMod as unknown as PathFinderCtor)) as PathFinderCtor;
import type { Feature, FeatureCollection, LineString, Point, Position } from 'geojson';
import type { LatLng } from '$lib/types';
import { cached, roundCoord } from './cache';
import { haversineKm } from '$lib/geo';

/** Overpass mirrors, tried in order. First successful response wins. */
const OVERPASS_MIRRORS = [
	'https://overpass.kumi.systems/api/interpreter',
	'https://overpass-api.de/api/interpreter',
	'https://lz4.overpass-api.de/api/interpreter',
	'https://overpass.osm.ch/api/interpreter'
];
/** Per-mirror network timeout in ms. */
const OVERPASS_TIMEOUT_MS = 12_000;
/** Reject sea-routing when from→to span exceeds this many degrees. */
const MAX_SPAN_DEG = 6;
/** Reject when the snap distance from from or to to the nearest ferry vertex exceeds this. */
const MAX_SNAP_KM = 50;
/** TTL for cached Overpass responses (24 h — ferry tags change rarely). */
const TTL_MS = 24 * 60 * 60 * 1000;

function bboxPadDeg(from: LatLng, to: LatLng): number {
	// Shrink the bbox for short hops so the Overpass payload stays small.
	const span = Math.max(Math.abs(from.lat - to.lat), Math.abs(from.lon - to.lon));
	if (span < 0.5) return 0.15;
	if (span < 1.5) return 0.25;
	return 0.4;
}

type OverpassWay = {
	id: number;
	type: 'way';
	geometry: { lat: number; lon: number }[];
};

type OverpassResponse = { elements: OverpassWay[] };

function bbox(from: LatLng, to: LatLng): { south: number; west: number; north: number; east: number } {
	const pad = bboxPadDeg(from, to);
	const south = Math.min(from.lat, to.lat) - pad;
	const north = Math.max(from.lat, to.lat) + pad;
	const west = Math.min(from.lon, to.lon) - pad;
	const east = Math.max(from.lon, to.lon) + pad;
	return { south, west, north, east };
}

async function postOverpass(mirror: string, body: string): Promise<Response> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS);
	try {
		return await fetch(mirror, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				'user-agent': 'weather-voodoo (https://weather-voodoo.vercel.app)'
			},
			body,
			signal: ctrl.signal
		});
	} finally {
		clearTimeout(t);
	}
}

async function fetchFerryWays(from: LatLng, to: LatLng): Promise<OverpassWay[]> {
	const b = bbox(from, to);
	const key = `osm-ferry:${roundCoord(b.south, 1)}:${roundCoord(b.west, 1)}:${roundCoord(b.north, 1)}:${roundCoord(b.east, 1)}`;
	return cached(
		key,
		async () => {
			// Use a tight server-side Overpass timeout so a slow mirror returns
			// quickly and lets us fall through to the next one.
			const query = `[out:json][timeout:10];way["route"="ferry"](${b.south},${b.west},${b.north},${b.east});out geom;`;
			const body = 'data=' + encodeURIComponent(query);
			const failures: string[] = [];
			for (const mirror of OVERPASS_MIRRORS) {
				try {
					const res = await postOverpass(mirror, body);
					if (!res.ok) {
						failures.push(`${new URL(mirror).host}: HTTP ${res.status}`);
						continue;
					}
					const data = (await res.json()) as OverpassResponse;
					return data.elements.filter(
						(e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2
					);
				} catch (e) {
					failures.push(
						`${new URL(mirror).host}: ${e instanceof Error ? e.name + ': ' + e.message : String(e)}`
					);
				}
			}
			throw new Error('All Overpass mirrors failed — ' + failures.join(' | '));
		},
		TTL_MS
	);
}

function waysToFeatureCollection(ways: OverpassWay[]): FeatureCollection<LineString> {
	const features = ways.map<Feature<LineString>>((w) => ({
		type: 'Feature',
		properties: { id: w.id },
		geometry: {
			type: 'LineString',
			coordinates: w.geometry.map(({ lat, lon }) => [lon, lat])
		}
	}));
	return { type: 'FeatureCollection', features };
}

function nearestVertex(ways: OverpassWay[], p: LatLng): { vertex: LatLng; km: number } | null {
	let best: { vertex: LatLng; km: number } | null = null;
	for (const w of ways) {
		for (const g of w.geometry) {
			const km = haversineKm(p, { lat: g.lat, lon: g.lon });
			if (!best || km < best.km) best = { vertex: { lat: g.lat, lon: g.lon }, km };
		}
	}
	return best;
}

function pointFeature(p: LatLng): Feature<Point> {
	return {
		type: 'Feature',
		properties: {},
		geometry: { type: 'Point', coordinates: [p.lon, p.lat] }
	};
}

export type FerryRouteResult = {
	polyline: LatLng[];
	lengthKm: number;
	originSnapKm: number;
	destinationSnapKm: number;
	wayCount: number;
};

export type FerryRouteFailureReason =
	| 'span-too-wide'
	| 'overpass-failed'
	| 'no-ways'
	| 'snap-too-far'
	| 'no-path';

export type FerryRouteOutcome =
	| { ok: true; result: FerryRouteResult }
	| { ok: false; reason: FerryRouteFailureReason; detail?: string };

/**
 * Try to route from→to along OpenStreetMap-tagged ferry ways. Returns a
 * tagged outcome so the caller can distinguish "fall through to the next
 * strategy" from "something concrete went wrong" and surface it.
 */
export async function computeFerryRoute(
	from: LatLng,
	to: LatLng
): Promise<FerryRouteOutcome> {
	if (Math.abs(from.lat - to.lat) > MAX_SPAN_DEG || Math.abs(from.lon - to.lon) > MAX_SPAN_DEG) {
		return { ok: false, reason: 'span-too-wide' };
	}

	let ways: OverpassWay[];
	try {
		ways = await fetchFerryWays(from, to);
	} catch (e) {
		const detail = e instanceof Error ? e.message : String(e);
		console.warn('[osm-ferry] Overpass fetch failed:', detail);
		return { ok: false, reason: 'overpass-failed', detail };
	}
	if (ways.length === 0) {
		return { ok: false, reason: 'no-ways' };
	}

	const fromSnap = nearestVertex(ways, from);
	const toSnap = nearestVertex(ways, to);
	if (!fromSnap || !toSnap) return { ok: false, reason: 'no-ways' };
	if (fromSnap.km > MAX_SNAP_KM || toSnap.km > MAX_SNAP_KM) {
		return {
			ok: false,
			reason: 'snap-too-far',
			detail: `from=${fromSnap.km.toFixed(1)}km, to=${toSnap.km.toFixed(1)}km`
		};
	}

	const fc = waysToFeatureCollection(ways);
	let pf: InstanceType<typeof PathFinder>;
	try {
		pf = new PathFinder(fc);
	} catch (e) {
		const detail = e instanceof Error ? e.message : String(e);
		return { ok: false, reason: 'no-path', detail };
	}
	const path = pf.findPath(pointFeature(fromSnap.vertex), pointFeature(toSnap.vertex));
	if (!path || !path.path || path.path.length < 2) {
		return { ok: false, reason: 'no-path' };
	}

	// path.path is Position[] = [lon, lat][]
	const interior: LatLng[] = (path.path as Position[]).map(([lon, lat]) => ({ lat, lon }));
	// Prepend / append the actual user endpoints so the polyline starts/ends
	// where they asked, rather than at the snapped vertex.
	const polyline: LatLng[] = [from, ...interior, to];

	let lengthKm = 0;
	for (let i = 1; i < polyline.length; i++) {
		lengthKm += haversineKm(polyline[i - 1], polyline[i]);
	}

	return {
		ok: true,
		result: {
			polyline,
			lengthKm,
			originSnapKm: fromSnap.km,
			destinationSnapKm: toSnap.km,
			wayCount: ways.length
		}
	};
}
