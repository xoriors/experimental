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
 * kumi.systems goes first. overpass-api.de rate-limits per IP, and a serverless
 * function leaves through an address shared with every other application on the
 * platform, so its allowance is often already spent by somebody else before our
 * visitor arrives — which is how a query this small earns a 504.
 */
const ENDPOINTS = [
	'https://overpass.kumi.systems/api/interpreter',
	'https://overpass-api.de/api/interpreter',
	'https://overpass.private.coffee/api/interpreter'
];

/** Every mirror gets a go at the real query; the best two also get the cheap one. */
const PLAN: Array<{ endpoint: string; tier: QueryTier }> = [
	...ENDPOINTS.map((endpoint) => ({ endpoint, tier: 'full' as QueryTier })),
	...ENDPOINTS.slice(0, 2).map((endpoint) => ({ endpoint, tier: 'lean' as QueryTier }))
];

const USER_AGENT =
	'solar-eclipse-2026/1.0 (eclipse viewing-spot finder; https://github.com/xoriors/experimental)';

/**
 * A mirror that has not answered in eight seconds is not thinking, it is
 * queueing behind somebody else's rate limit, and the next mirror is a better
 * use of the time than waiting it out.
 */
const ATTEMPT_TIMEOUT_MS = 8000;
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

	for (const { endpoint, tier } of PLAN) {
		const remaining = deadline - Date.now();
		if (remaining < MIN_ATTEMPT_MS) break;

		const host = new URL(endpoint).host;
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			Math.min(ATTEMPT_TIMEOUT_MS, remaining)
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
					// Viewing spots barely change, so let the edge answer most hits.
					'cache-control': 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800',
					'x-upstream': host,
					// Tells the page whether it is looking at the full search or the
					// cut-down one, so it can say so rather than quietly show less.
					'x-overpass-tier': tier
				}
			});
		} catch {
			notes.push(`${host} ${controller.signal.aborted ? 'ran out of time' : 'was unreachable'}`);
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
