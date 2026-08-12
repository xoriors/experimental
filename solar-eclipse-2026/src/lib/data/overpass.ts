/**
 * Candidate places to watch from, taken from OpenStreetMap via Overpass.
 *
 * Deliberately restricted to places you can drive to and either stand at or
 * settle into for an hour: marked viewpoints, car parks, picnic sites, lay-bys
 * and rest areas, terraces with outdoor seating, hotels, huts, campsites and
 * parks, plus hilltops and towers, which often have a road to them but
 * sometimes do not — those are labelled so the difference is clear.
 */

import type { Point } from '../eclipse/horizon';
import { clampRadius } from './overpass-query';

/**
 * Always our own endpoint, never Overpass directly. There is no browser route
 * to any full-planet instance, which is worth writing down because two of them
 * look as though there is:
 *
 * - overpass-api.de sends no `Access-Control-Allow-Origin` header, so the
 *   browser refuses the reply before it can be read.
 * - OSM France does send one, and answers a preflight cheerfully, but refuses
 *   the request itself: `403 This service is only available to white-listed
 *   usages`, triggered by the User-Agent alone. A browser cannot change its
 *   User-Agent, so nothing on this side can satisfy it.
 *
 * The endpoint also builds the query, identifies itself as Overpass's usage
 * policy asks, falls between mirrors, and lets the edge cache answer everybody
 * else searching the same town.
 */
const ENDPOINT = '/api/viewing-spots';

/**
 * Longer than the endpoint's own budget for talking to Overpass, deliberately.
 * If this fires first, a perfectly good explanation from the server — which
 * mirror said what — is discarded in favour of a generic line that names
 * nothing, which is precisely the failure this number used to cause.
 */
const TIMEOUT_MS = 40000;

export class OverpassError extends Error {}

export type SpotKind =
	| 'viewpoint'
	| 'parking'
	| 'picnic'
	| 'rest'
	| 'peak'
	| 'tower'
	| 'terrace'
	| 'stay'
	| 'park';

export interface Spot extends Point {
	id: string;
	name: string;
	kind: SpotKind;
	/** Elevation from the OSM tag when present; otherwise resolved later. */
	taggedElevationM?: number;
	/** True for kinds that are normally reachable by car. */
	drivable: boolean;
	/**
	 * True where you can reasonably settle in for an hour rather than stand at
	 * the roadside: a terrace, a hotel, a campsite, a park.
	 */
	canLinger: boolean;
	/** The OSM value behind the kind, e.g. "restaurant", so the card can say so. */
	detail?: string;
}

const KIND_LABELS: Record<SpotKind, string> = {
	viewpoint: 'Viewpoint',
	parking: 'Car park',
	picnic: 'Picnic site',
	rest: 'Rest area',
	peak: 'Summit',
	tower: 'Tower',
	terrace: 'Terrace',
	stay: 'Place to stay',
	park: 'Park'
};

/** Kinds you can sit at for an hour without being in the way. */
const LINGER_KINDS: ReadonlySet<SpotKind> = new Set<SpotKind>([
	'terrace',
	'stay',
	'park',
	'picnic',
	'rest',
	'viewpoint'
]);

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

const STAY_TOURISM = new Set([
	'hotel',
	'guest_house',
	'chalet',
	'alpine_hut',
	'wilderness_hut',
	'camp_site',
	'caravan_site'
]);

function classify(tags: Record<string, string>): { kind: SpotKind; detail?: string } | null {
	if (tags.tourism === 'viewpoint') return { kind: 'viewpoint' };
	if (tags.tourism === 'picnic_site' || tags.leisure === 'picnic_table') return { kind: 'picnic' };
	if (tags.highway === 'rest_area' || tags.highway === 'services') return { kind: 'rest' };
	if (tags.natural === 'peak') return { kind: 'peak' };
	if (tags.man_made === 'tower' && tags.tourism === 'attraction') return { kind: 'tower' };

	if (tags.amenity === 'biergarten') return { kind: 'terrace', detail: 'beer garden' };
	if (
		tags.outdoor_seating === 'yes' &&
		['restaurant', 'cafe', 'bar', 'pub'].includes(tags.amenity ?? '')
	) {
		return { kind: 'terrace', detail: tags.amenity };
	}

	if (STAY_TOURISM.has(tags.tourism ?? '')) {
		return { kind: 'stay', detail: tags.tourism?.replace(/_/g, ' ') };
	}
	if (tags.leisure === 'park' || tags.leisure === 'garden') {
		return { kind: 'park', detail: tags.leisure };
	}

	if (tags.amenity === 'parking') return { kind: 'parking' };
	return null;
}

export interface SpotSearch {
	spots: Spot[];
	/**
	 * True when every mirror refused the full query and the endpoint fell back
	 * to its cheaper one: fewer categories, shorter radius. The page says so
	 * rather than presenting a thin list as the whole picture.
	 */
	reduced: boolean;
}

/**
 * Places within `radiusM` of a point. `radiusM` is capped because Overpass is a
 * shared free service and a hundred-kilometre query over a city is expensive.
 */
export async function findSpots(
	centre: Point,
	radiusM: number,
	signal?: AbortSignal
): Promise<SpotSearch> {
	const radius = clampRadius(radiusM);
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
		throw new OverpassError(
			timeout.signal.aborted
				? 'Looking for nearby viewing spots took too long and was given up on.'
				: 'Could not reach OpenStreetMap to look for viewing spots.'
		);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}

	if (!response.ok) {
		// The endpoint puts a readable explanation in the body. If it did not, the
		// failure happened above it — name the status rather than blaming
		// OpenStreetMap for something the hosting platform did.
		let message = `The viewing-spot search failed (HTTP ${response.status}).`;
		try {
			const body = (await response.json()) as { message?: string };
			if (body?.message) message = body.message;
		} catch {
			/* keep the status-based message */
		}
		throw new OverpassError(message);
	}

	const body = (await response.json()) as { elements?: RawElement[] };
	return {
		spots: parse(body.elements ?? []),
		reduced: response.headers.get('x-overpass-tier') === 'lean'
	};
}

function parse(elements: RawElement[]): Spot[] {
	const spots: Spot[] = [];
	for (const element of elements) {
		const tags = element.tags ?? {};
		const classified = classify(tags);
		if (!classified) continue;
		const { kind, detail } = classified;
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
			drivable: kind !== 'peak' && kind !== 'tower',
			canLinger: LINGER_KINDS.has(kind),
			detail
		});
	}
	return spots;
}
