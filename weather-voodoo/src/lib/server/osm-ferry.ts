import PathFinder from 'geojson-path-finder';
import type { Feature, FeatureCollection, LineString, Point, Position } from 'geojson';
import type { LatLng } from '$lib/types';
import { cached, roundCoord } from './cache';
import { haversineKm } from '$lib/geo';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/** Padding around the from→to bbox (degrees) when querying Overpass. */
const BBOX_PAD_DEG = 0.4;
/** Reject sea-routing when from→to span exceeds this many degrees. */
const MAX_SPAN_DEG = 6;
/** Reject when the snap distance from from or to to the nearest ferry vertex exceeds this. */
const MAX_SNAP_KM = 25;
/** TTL for cached Overpass responses (24 h — ferry tags change rarely). */
const TTL_MS = 24 * 60 * 60 * 1000;

type OverpassWay = {
	id: number;
	type: 'way';
	geometry: { lat: number; lon: number }[];
};

type OverpassResponse = { elements: OverpassWay[] };

function bbox(from: LatLng, to: LatLng): { south: number; west: number; north: number; east: number } {
	const south = Math.min(from.lat, to.lat) - BBOX_PAD_DEG;
	const north = Math.max(from.lat, to.lat) + BBOX_PAD_DEG;
	const west = Math.min(from.lon, to.lon) - BBOX_PAD_DEG;
	const east = Math.max(from.lon, to.lon) + BBOX_PAD_DEG;
	return { south, west, north, east };
}

async function fetchFerryWays(from: LatLng, to: LatLng): Promise<OverpassWay[]> {
	const b = bbox(from, to);
	const key = `osm-ferry:${roundCoord(b.south, 1)}:${roundCoord(b.west, 1)}:${roundCoord(b.north, 1)}:${roundCoord(b.east, 1)}`;
	return cached(
		key,
		async () => {
			const query = `[out:json][timeout:25];way["route"="ferry"](${b.south},${b.west},${b.north},${b.east});out geom;`;
			const res = await fetch(OVERPASS_URL, {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					'user-agent': 'weather-voodoo (https://weather-voodoo.vercel.app)'
				},
				body: 'data=' + encodeURIComponent(query)
			});
			if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
			const data = (await res.json()) as OverpassResponse;
			return data.elements.filter((e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2);
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

/**
 * Try to route from→to along OpenStreetMap-tagged ferry ways.
 * Returns null if the bbox is too wide, the network is too sparse, the
 * snap distance is too large, or no continuous path exists.
 */
export async function computeFerryRoute(from: LatLng, to: LatLng): Promise<FerryRouteResult | null> {
	if (Math.abs(from.lat - to.lat) > MAX_SPAN_DEG || Math.abs(from.lon - to.lon) > MAX_SPAN_DEG) {
		return null;
	}

	let ways: OverpassWay[];
	try {
		ways = await fetchFerryWays(from, to);
	} catch (e) {
		console.warn('[osm-ferry] Overpass fetch failed:', e instanceof Error ? e.message : e);
		return null;
	}
	if (ways.length === 0) {
		console.warn('[osm-ferry] no ferry ways in bbox');
		return null;
	}

	const fromSnap = nearestVertex(ways, from);
	const toSnap = nearestVertex(ways, to);
	if (!fromSnap || !toSnap) return null;
	if (fromSnap.km > MAX_SNAP_KM || toSnap.km > MAX_SNAP_KM) return null;

	const fc = waysToFeatureCollection(ways);
	let pf: PathFinder<unknown, Record<string, unknown>>;
	try {
		pf = new PathFinder(fc);
	} catch {
		return null;
	}
	const path = pf.findPath(pointFeature(fromSnap.vertex), pointFeature(toSnap.vertex));
	if (!path || !path.path || path.path.length < 2) return null;

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
		polyline,
		lengthKm,
		originSnapKm: fromSnap.km,
		destinationSnapKm: toSnap.km,
		wayCount: ways.length
	};
}
