import * as PathFinderMod from 'geojson-path-finder';

type PathFinderCtor = new (
	network: FeatureCollection<LineString>
) => {
	findPath(a: Feature<Point>, b: Feature<Point>): { path: Position[]; weight: number } | undefined;
};

// geojson-path-finder's CJS-to-ESM interop varies by bundler — handle every layer.
type MaybeWrapped = { default?: MaybeWrapped | PathFinderCtor } & Record<string, unknown>;
const _mod = PathFinderMod as unknown as MaybeWrapped;
const _layer1 = (_mod.default ?? _mod) as MaybeWrapped;
const _layer2 = ((_layer1 as MaybeWrapped).default ?? _layer1) as MaybeWrapped;
const PathFinder = (typeof _layer2 === 'function' ? _layer2 : _layer1) as unknown as PathFinderCtor;
import type { Feature, FeatureCollection, LineString, Point, Position } from 'geojson';
import type { LatLng } from '$lib/types';
import { cached, roundCoord } from './cache';
import { haversineKm } from '$lib/geo';

const OVERPASS_MIRRORS = [
	'https://overpass.kumi.systems/api/interpreter',
	'https://overpass-api.de/api/interpreter',
	'https://lz4.overpass-api.de/api/interpreter',
	'https://overpass.osm.ch/api/interpreter'
];
const OVERPASS_TIMEOUT_MS = 12_000;

// Trail networks are dense — keep the search area tight so the Overpass payload
// stays bounded and the path-finding graph fits in memory.
const MAX_SPAN_DEG = 1.5;
const MAX_SNAP_KM = 5;
const TTL_MS = 24 * 60 * 60 * 1000;

type TrailKind = 'hike' | 'bike';

type OverpassWay = {
	id: number;
	type: 'way';
	geometry: { lat: number; lon: number }[];
	tags?: Record<string, string>;
};

type OverpassResponse = { elements: OverpassWay[] };

function bboxPadDeg(from: LatLng, to: LatLng): number {
	const span = Math.max(Math.abs(from.lat - to.lat), Math.abs(from.lon - to.lon));
	// Trail networks are dense — keep the pad tight, especially for short hops.
	if (span < 0.05) return 0.02;
	if (span < 0.1) return 0.03;
	if (span < 0.3) return 0.06;
	if (span < 0.8) return 0.12;
	return 0.2;
}

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

function buildQuery(b: { south: number; west: number; north: number; east: number }): string {
	const bb = `${b.south},${b.west},${b.north},${b.east}`;
	// path / footway / track / bridleway — hiking-friendly
	// cycleway — dedicated bike paths
	// pedestrian / steps — urban walking
	// foot=designated / bicycle=designated — explicit non-highway routing tags
	return (
		`[out:json][timeout:10];` +
		`(` +
		`way["highway"="path"](${bb});` +
		`way["highway"="footway"](${bb});` +
		`way["highway"="track"](${bb});` +
		`way["highway"="bridleway"](${bb});` +
		`way["highway"="cycleway"](${bb});` +
		`way["highway"="pedestrian"](${bb});` +
		`way["highway"="steps"](${bb});` +
		`way["foot"="designated"](${bb});` +
		`way["bicycle"="designated"](${bb});` +
		`);` +
		`out tags geom;`
	);
}

async function fetchTrailWays(from: LatLng, to: LatLng): Promise<OverpassWay[]> {
	const b = bbox(from, to);
	const key = `osm-land:${roundCoord(b.south, 1)}:${roundCoord(b.west, 1)}:${roundCoord(b.north, 1)}:${roundCoord(b.east, 1)}`;
	return cached(
		key,
		async () => {
			const query = buildQuery(b);
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

function classifyWay(w: OverpassWay): TrailKind {
	const t = w.tags ?? {};
	const hw = t.highway;
	if (hw === 'cycleway') return 'bike';
	if (t.bicycle === 'designated' && t.foot !== 'designated') return 'bike';
	// Everything else (path/footway/track/bridleway/pedestrian/steps + foot=designated)
	// is hiking-friendly; mixed-use trails count as hiking by default.
	return 'hike';
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

function pointFeature(p: LatLng): Feature<Point> {
	return {
		type: 'Feature',
		properties: {},
		geometry: { type: 'Point', coordinates: [p.lon, p.lat] }
	};
}

export type TrailRouteResult = {
	polyline: LatLng[];
	lengthKm: number;
	originSnapKm: number;
	destinationSnapKm: number;
	wayCount: number;
	hikeWayCount: number;
	bikeWayCount: number;
};

export type TrailRouteFailureReason =
	| 'span-too-wide'
	| 'overpass-failed'
	| 'no-ways'
	| 'snap-too-far'
	| 'no-path';

export type TrailRouteOutcome =
	| { ok: true; result: TrailRouteResult }
	| { ok: false; reason: TrailRouteFailureReason; detail?: string };

/**
 * Try to route from→to along OpenStreetMap-tagged hiking and cycling ways
 * (path, footway, track, bridleway, cycleway, pedestrian, steps, plus ways
 * tagged foot=designated or bicycle=designated). Mirrors the structure of
 * the ferry resolver: snap each endpoint to the nearest vertex, run
 * geojson-path-finder over the network, and stitch the real endpoints back on.
 */
export async function computeLandTrailRoute(
	from: LatLng,
	to: LatLng
): Promise<TrailRouteOutcome> {
	if (Math.abs(from.lat - to.lat) > MAX_SPAN_DEG || Math.abs(from.lon - to.lon) > MAX_SPAN_DEG) {
		return { ok: false, reason: 'span-too-wide' };
	}

	let ways: OverpassWay[];
	try {
		ways = await fetchTrailWays(from, to);
	} catch (e) {
		const detail = e instanceof Error ? e.message : String(e);
		console.warn('[osm-land] Overpass fetch failed:', detail);
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

	const interior: LatLng[] = (path.path as Position[]).map(([lon, lat]) => ({ lat, lon }));
	const polyline: LatLng[] = [from, ...interior, to];

	let lengthKm = 0;
	for (let i = 1; i < polyline.length; i++) {
		lengthKm += haversineKm(polyline[i - 1], polyline[i]);
	}

	let hikeWayCount = 0;
	let bikeWayCount = 0;
	for (const w of ways) {
		if (classifyWay(w) === 'bike') bikeWayCount++;
		else hikeWayCount++;
	}

	return {
		ok: true,
		result: {
			polyline,
			lengthKm,
			originSnapKm: fromSnap.km,
			destinationSnapKm: toSnap.km,
			wayCount: ways.length,
			hikeWayCount,
			bikeWayCount
		}
	};
}
