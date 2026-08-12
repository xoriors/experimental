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
import { buildQuery, clampRadius } from './overpass-query';
import { looksHealthy } from './overpass-health';

/**
 * Our own endpoint first: it builds the query, identifies itself as Overpass's
 * usage policy asks, falls between mirrors, and lets the edge cache answer for
 * everybody else searching the same town.
 */
const ENDPOINT = '/api/viewing-spots';

/**
 * And a way round it, because the proxy has a weakness the browser does not.
 * Overpass rations by IP; a serverless function leaves through an address
 * shared with every other application on the platform, and from Vercel every
 * mirror currently times out. A visitor's own connection has its own allowance
 * and a shorter path, so when the endpoint cannot get an answer, the browser
 * asks directly.
 *
 * Only OSM France is reachable this way: alone among the full-planet instances
 * it sends `Access-Control-Allow-Origin: *`, which is an explicit invitation to
 * browser callers. overpass-api.de sends no CORS headers at all, which is what
 * made the proxy necessary in the first place.
 */
const DIRECT_ENDPOINT = 'https://overpass.openstreetmap.fr/api/interpreter';

/**
 * How long the endpoint gets to itself before the browser also tries. Long
 * enough that a healthy endpoint — answering from the edge cache in
 * milliseconds — never causes a second request to a free service, short enough
 * that a visitor is not watching a spinner while the proxy works through three
 * mirrors that will not answer.
 */
const HEAD_START_MS = 3000;

/**
 * Longer than the endpoint's own budget for talking to Overpass, deliberately.
 * If this fires first, a perfectly good explanation from the server — which
 * mirror said what — is discarded in favour of a generic line that names
 * nothing, which is precisely the failure this number used to cause.
 */
const TIMEOUT_MS = 40000;
const DIRECT_TIMEOUT_MS = 25000;

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

/** A fetch with its own deadline, cancellable by the caller as well. */
async function fetchWithin(
	url: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
	failed: (timedOut: boolean) => string
): Promise<Response> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), timeoutMs);
	const onAbort = () => timeout.abort();
	signal?.addEventListener('abort', onAbort);

	try {
		return await fetch(url, { signal: timeout.signal });
	} catch (error) {
		if (signal?.aborted) throw error;
		throw new OverpassError(failed(timeout.signal.aborted));
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
}

/** The endpoint on our own origin, which caches and falls between mirrors. */
async function viaProxy(
	centre: Point,
	radius: number,
	signal?: AbortSignal
): Promise<SpotSearch> {
	const url = `${ENDPOINT}?lat=${centre.lat.toFixed(5)}&lon=${centre.lon.toFixed(5)}&radius=${radius}`;
	const response = await fetchWithin(url, TIMEOUT_MS, signal, (timedOut) =>
		timedOut
			? 'Looking for nearby viewing spots took too long and was given up on.'
			: 'Could not reach OpenStreetMap to look for viewing spots.'
	);

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

/**
 * Straight from the browser to OSM France. A GET with no custom headers is a
 * "simple" cross-origin request, so it goes without a preflight — one round
 * trip rather than two, from a visitor who is probably nearer to it than our
 * function is.
 */
async function viaDirect(
	centre: Point,
	radius: number,
	signal?: AbortSignal
): Promise<SpotSearch> {
	// Rounded exactly as the endpoint rounds it, so the two routes cannot
	// disagree about what was asked.
	const query = buildQuery(Number(centre.lat.toFixed(2)), Number(centre.lon.toFixed(2)), radius);
	const response = await fetchWithin(
		`${DIRECT_ENDPOINT}?data=${encodeURIComponent(query)}`,
		DIRECT_TIMEOUT_MS,
		signal,
		() => 'Could not reach OpenStreetMap to look for viewing spots.'
	);
	if (!response.ok) {
		throw new OverpassError(`OpenStreetMap replied ${response.status} to the direct request.`);
	}

	const body = (await response.json()) as { elements?: RawElement[] };
	const health = looksHealthy(body);
	if (!health.ok) throw new OverpassError(`OpenStreetMap could not answer: ${health.reason}.`);

	return { spots: parse(body.elements ?? []), reduced: false };
}

function headStart(signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, HEAD_START_MS);
		signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			reject(new DOMException('Aborted', 'AbortError'));
		});
	});
}

/**
 * Places within `radiusM` of a point. `radiusM` is capped because Overpass is a
 * shared free service and a hundred-kilometre query over a city is expensive.
 *
 * Two routes to the same answer, and whichever arrives first wins. The proxy is
 * preferred and gets a head start, because it caches and behaves itself; the
 * direct call exists because the proxy's address is shared with the rest of the
 * platform and Overpass rations by address, which is a problem no amount of
 * retrying from the same place can solve.
 */
export async function findSpots(
	centre: Point,
	radiusM: number,
	signal?: AbortSignal
): Promise<SpotSearch> {
	const radius = clampRadius(radiusM);

	// Kept aside because it is the more informative of the two: it can name the
	// mirror and the status, where the browser only learns that it did not work.
	let proxyFailure: Error | undefined;

	try {
		return await Promise.any([
			viaProxy(centre, radius, signal).catch((error: Error) => {
				proxyFailure = error;
				throw error;
			}),
			headStart(signal).then(() => viaDirect(centre, radius, signal))
		]);
	} catch (caught) {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		if (proxyFailure) throw proxyFailure;
		throw caught instanceof AggregateError ? caught.errors[0] : caught;
	}
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
