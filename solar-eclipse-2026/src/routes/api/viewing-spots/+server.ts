/**
 * Server-side proxy for the OpenStreetMap viewing-spot lookup.
 *
 * Overpass answers happily server-to-server but sends no
 * Access-Control-Allow-Origin header, so a browser cannot call it directly —
 * the request fails as a CORS error before the response is ever readable.
 * Going through our own origin removes the problem, and brings three other
 * benefits: we can identify ourselves properly as Overpass's usage policy asks,
 * cache the answer so a shared free service is not hit once per visitor, and
 * fall between instances without the browser noticing.
 *
 * The Overpass query is built here rather than accepted from the client, so
 * this endpoint cannot be used as an open proxy for arbitrary Overpass QL.
 *
 * Everything about the timing below is chosen so that whatever happens, the
 * browser gets *this* route's explanation of what went wrong. Two 25-second
 * attempts used to add up to more patience than the client had, so a perfectly
 * good "Overpass replied 504" was thrown away and the page fell back to a
 * generic "could not reach OpenStreetMap" that named nothing.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { looksHealthy, type OverpassBody } from '$lib/data/overpass-health';
import { buildQuery, clampRadius, type QueryTier } from '$lib/data/overpass-query';

export const prerender = false;

/** Well clear of the budget below, so the platform never truncates us. */
export const config = { maxDuration: 30 };

/**
 * Full-planet Overpass instances only. Regional mirrors such as
 * overpass.osm.ch answer with a cheerful 200 and an empty element list for
 * anywhere outside their own country, which is indistinguishable from "there
 * is nothing here" unless you check — see `looksHealthy`.
 *
 * Order is by what each one measurably does, not by reputation:
 *
 * - OSM France answers a query in the Carpathians in about a second from a
 *   database minutes old, and is run by a different organisation from the
 *   others, which is the only kind of redundancy worth having.
 * - overpass-api.de is the canonical instance and its data is current, but it
 *   rations per IP — and a serverless function leaves through an address shared
 *   with every other application on the platform, so its allowance is often
 *   spent by somebody else before our visitor arrives. That is how a query this
 *   small earned the 504 that started all this.
 * - kumi.systems last: it answers, but erratically, and its database was three
 *   months behind when this was written. Fine as a fallback for car parks and
 *   hilltops, which do not move.
 *
 * overpass.private.coffee is deliberately absent: it resolves to the same
 * machine as kumi.systems, so listing both would look like redundancy and
 * provide none.
 */
const ENDPOINTS = [
	'https://overpass.openstreetmap.fr/api/interpreter',
	'https://overpass-api.de/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter'
];

/**
 * Interleaved rather than all the full attempts first, because the two ways a
 * query fails want different answers and only one of them is "try elsewhere".
 * Sixty kilometres around Bucharest costs 14 seconds as the full query and
 * three as the cheap one — no mirror on earth will do better at the first, and
 * every one of them manages the second. Asking the same instance for less is
 * therefore a better second move than asking a different instance for the same.
 */
const PLAN: Array<{ endpoint: string; tier: QueryTier }> = ENDPOINTS.flatMap((endpoint) => [
	{ endpoint, tier: 'full' as QueryTier },
	{ endpoint, tier: 'lean' as QueryTier }
]);

const USER_AGENT =
	'solar-eclipse-2026/1.0 (eclipse viewing-spot finder; https://github.com/xoriors/experimental)';

/**
 * Eight seconds is comfortably more than the three the full query takes where
 * it works at all, so a mirror still silent at that point is either queueing or
 * being asked for more than it can manage — and in both cases the next attempt
 * is a better use of the time than waiting this one out. The cheap query gets
 * less, because it has less to do.
 */
const ATTEMPT_TIMEOUT_MS: Record<QueryTier, number> = { full: 8000, lean: 6000 };
const TOTAL_BUDGET_MS = 24000;
const MIN_ATTEMPT_MS = 3000;

/**
 * A missing parameter must not read as zero: `Number(null)` is 0, which would
 * turn a malformed request into a perfectly valid search of the Gulf of Guinea
 * — or, for the radius, into the 2 km minimum, whose empty result looks
 * exactly like "nothing is mapped near you".
 */
function numberParam(url: URL, name: string): number | null {
	const raw = url.searchParams.get(name);
	if (raw === null || raw.trim() === '') return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

export const GET: RequestHandler = async ({ url, fetch }) => {
	const lat = numberParam(url, 'lat');
	const lon = numberParam(url, 'lon');
	const radius = numberParam(url, 'radius');

	if (lat === null || Math.abs(lat) > 90) error(400, 'Bad latitude.');
	if (lon === null || Math.abs(lon) > 180) error(400, 'Bad longitude.');
	if (radius === null) error(400, 'Bad radius.');

	// Rounding to about a kilometre keeps the cache useful: everyone searching
	// from the same town shares one upstream request. Distances are measured
	// from the caller's exact position on the client anyway.
	const roundedLat = Number(lat.toFixed(2));
	const roundedLon = Number(lon.toFixed(2));
	const roundedRadius = clampRadius(radius);

	const deadline = Date.now() + TOTAL_BUDGET_MS;
	const notes: string[] = [];
	/**
	 * Hosts that could not be spoken to at all. Being asked for less does not
	 * help a mirror that is down, so its cheap attempt is dropped and the slot
	 * goes to somebody who might answer.
	 */
	const unreachable = new Set<string>();

	for (const { endpoint, tier } of PLAN) {
		const remaining = deadline - Date.now();
		if (remaining < MIN_ATTEMPT_MS) break;

		const host = new URL(endpoint).host;
		if (unreachable.has(host)) continue;

		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			Math.min(ATTEMPT_TIMEOUT_MS[tier], remaining)
		);
		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					'user-agent': USER_AGENT
				},
				body: new URLSearchParams({
					data: buildQuery(roundedLat, roundedLon, roundedRadius, tier)
				}),
				signal: controller.signal
			});
			if (!response.ok) {
				// 429 and 504 both mean the same thing in practice: too many people,
				// us included, are asking one free service for favours.
				notes.push(`${host} replied ${response.status}`);
				continue;
			}
			const body = (await response.json()) as OverpassBody;

			const health = looksHealthy(body);
			if (!health.ok) {
				notes.push(`${host}: ${health.reason}`);
				continue;
			}

			return json(body, {
				headers: {
					// Viewing spots barely change, so let the edge answer most hits —
					// but a reduced answer must not be cached for a day, or one busy
					// minute leaves everyone searching that town a short list until
					// tomorrow.
					'cache-control':
						tier === 'full'
							? 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800'
							: 'public, max-age=60, s-maxage=300',
					'x-upstream': host,
					// Tells the page whether it is looking at the full search or the
					// cut-down one, so it can say so rather than quietly show less.
					'x-overpass-tier': tier,
					// How far behind that mirror's copy of OpenStreetMap is, so a mirror
					// quietly drifting out of date is visible without guesswork.
					'x-osm-age-days': String(health.ageDays ?? '')
				}
			});
		} catch {
			// Running out of time says something about the question, so the same
			// mirror is still worth asking something smaller. Failing to connect
			// says something about the mirror, and nothing smaller will fix it.
			if (controller.signal.aborted) {
				notes.push(`${host} ran out of time`);
			} else {
				unreachable.add(host);
				notes.push(`${host} was unreachable`);
			}
		} finally {
			clearTimeout(timer);
		}
	}

	const detail = [...new Set(notes)].slice(0, 3).join('; ');
	error(
		503,
		`OpenStreetMap's Overpass service is not answering${detail ? ` (${detail})` : ''}. ` +
			'It is a free shared service — try again in a minute, or with a shorter drive.'
	);
};
