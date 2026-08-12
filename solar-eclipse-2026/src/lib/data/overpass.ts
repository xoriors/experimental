/**
 * Candidate places to watch from, taken from OpenStreetMap via Overpass.
 *
 * Deliberately restricted to things you can drive to and stand at: marked
 * viewpoints, car parks, picnic sites, lay-bys and rest areas, plus hilltops
 * and towers, which often have a road to them but sometimes do not — those are
 * labelled so the difference is clear.
 */

import type { Point } from '../eclipse/horizon';

/**
 * Our own endpoint rather than Overpass directly: Overpass sends no CORS
 * headers, so a browser call to it fails before the response can be read.
 * The server side builds the query and talks to Overpass on our behalf.
 */
const ENDPOINT = '/api/viewing-spots';
const TIMEOUT_MS = 30000;

export class OverpassError extends Error {}

export type SpotKind = 'viewpoint' | 'parking' | 'picnic' | 'rest' | 'peak' | 'tower';

export interface Spot extends Point {
	id: string;
	name: string;
	kind: SpotKind;
	/** Elevation from the OSM tag when present; otherwise resolved later. */
	taggedElevationM?: number;
	/** True for kinds that are normally reachable by car. */
	drivable: boolean;
}

const KIND_LABELS: Record<SpotKind, string> = {
	viewpoint: 'Viewpoint',
	parking: 'Car park',
	picnic: 'Picnic site',
	rest: 'Rest area',
	peak: 'Summit',
	tower: 'Tower'
};

export function labelForKind(kind: SpotKind): string {
	return KIND_LABELS[kind];
}

interface RawElement {
	type: string;
	id: number;
	lat?: number;
	lon?: number;
	center?: { lat: number; lon: number };
	tags?: Record<string, string>;
}

function classify(tags: Record<string, string>): SpotKind | null {
	if (tags.tourism === 'viewpoint') return 'viewpoint';
	if (tags.tourism === 'picnic_site' || tags.leisure === 'picnic_table') return 'picnic';
	if (tags.highway === 'rest_area' || tags.highway === 'services') return 'rest';
	if (tags.amenity === 'parking') return 'parking';
	if (tags.natural === 'peak') return 'peak';
	if (tags.man_made === 'tower' && tags.tourism === 'attraction') return 'tower';
	return null;
}

/**
 * Places within `radiusM` of a point. `radiusM` is capped because Overpass is a
 * shared free service and a hundred-kilometre query over a city is expensive.
 */
export async function findSpots(
	centre: Point,
	radiusM: number,
	signal?: AbortSignal
): Promise<Spot[]> {
	const radius = Math.min(Math.max(Math.round(radiusM), 2000), 80000);
	const url = `${ENDPOINT}?lat=${centre.lat.toFixed(5)}&lon=${centre.lon.toFixed(5)}&radius=${radius}`;

	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
	const onAbort = () => timeout.abort();
	signal?.addEventListener('abort', onAbort);

	let response: Response;
	try {
		response = await fetch(url, { signal: timeout.signal });
	} catch (error) {
		if (signal?.aborted) throw error;
		throw new OverpassError('Could not reach OpenStreetMap to look for viewing spots.');
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}

	if (!response.ok) {
		// The endpoint puts a readable explanation in the body; fall back to a
		// generic line if it did not.
		let message = 'Could not reach OpenStreetMap to look for viewing spots.';
		try {
			const body = (await response.json()) as { message?: string };
			if (body?.message) message = body.message;
		} catch {
			/* keep the generic message */
		}
		throw new OverpassError(message);
	}

	const body = (await response.json()) as { elements?: RawElement[] };
	return parse(body.elements ?? []);
}

function parse(elements: RawElement[]): Spot[] {
	const spots: Spot[] = [];
	for (const element of elements) {
		const tags = element.tags ?? {};
		const kind = classify(tags);
		if (!kind) continue;
		const lat = element.lat ?? element.center?.lat;
		const lon = element.lon ?? element.center?.lon;
		if (lat === undefined || lon === undefined) continue;

		const tagged = Number.parseFloat(tags.ele ?? '');
		spots.push({
			id: `${element.type}/${element.id}`,
			name: tags.name?.trim() || `Unnamed ${KIND_LABELS[kind].toLowerCase()}`,
			kind,
			lat,
			lon,
			taggedElevationM: Number.isFinite(tagged) ? tagged : undefined,
			// Summits and towers may well need a walk; the rest are roadside.
			drivable: kind !== 'peak' && kind !== 'tower'
		});
	}
	return spots;
}
