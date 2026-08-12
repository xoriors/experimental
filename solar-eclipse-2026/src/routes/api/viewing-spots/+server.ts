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
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { looksHealthy, type OverpassBody } from '$lib/data/overpass-health';

export const prerender = false;

/**
 * Full-planet Overpass instances only. Regional mirrors such as
 * overpass.osm.ch answer with a cheerful 200 and an empty element list for
 * anywhere outside their own country, which is indistinguishable from "there
 * is nothing here" unless you check — see `looksHealthy`.
 */
const ENDPOINTS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter'
];

const USER_AGENT =
	'solar-eclipse-2026/1.0 (eclipse viewing-spot finder; https://github.com/xoriors/experimental)';

const MIN_RADIUS_M = 2000;
const MAX_RADIUS_M = 80000;
const UPSTREAM_TIMEOUT_MS = 25000;

function buildQuery(lat: number, lon: number, radiusM: number): string {
	const at = `${lat},${lon}`;
	const wide = `${radiusM},${at}`;
	// Places to sit are far more numerous than viewpoints, so they get a tighter
	// radius and must clear a bar: somewhere with outdoor seating, or a named
	// hotel, hut, campsite or park. An indoor table with no window west is no
	// use for watching a sunset.
	const venues = `${Math.min(radiusM, 35000)},${at}`;
	const parking = `${Math.min(radiusM, 30000)},${at}`;

	return `[out:json][timeout:25];
(
  node["tourism"="viewpoint"](around:${wide});
  way["tourism"="viewpoint"](around:${wide});
  node["tourism"="picnic_site"](around:${wide});
  node["highway"~"^(rest_area|services)$"](around:${wide});
  node["natural"="peak"](around:${wide});
  node["amenity"~"^(restaurant|cafe|bar|pub)$"]["outdoor_seating"="yes"](around:${venues});
  way["amenity"~"^(restaurant|cafe|bar|pub)$"]["outdoor_seating"="yes"](around:${venues});
  node["amenity"="biergarten"](around:${venues});
  node["tourism"~"^(hotel|guest_house|chalet|alpine_hut|wilderness_hut|camp_site|caravan_site)$"]["name"](around:${venues});
  way["tourism"~"^(hotel|guest_house|chalet|alpine_hut|wilderness_hut|camp_site|caravan_site)$"]["name"](around:${venues});
  node["leisure"~"^(park|garden)$"]["name"](around:${venues});
  way["leisure"~"^(park|garden)$"]["name"](around:${venues});
  node["amenity"="parking"]["name"](around:${parking});
  way["amenity"="parking"]["name"](around:${parking});
);
out center tags 250;`;
}

export const GET: RequestHandler = async ({ url, fetch }) => {
	const lat = Number(url.searchParams.get('lat'));
	const lon = Number(url.searchParams.get('lon'));
	const radius = Number(url.searchParams.get('radius'));

	if (!Number.isFinite(lat) || Math.abs(lat) > 90) error(400, 'Bad latitude.');
	if (!Number.isFinite(lon) || Math.abs(lon) > 180) error(400, 'Bad longitude.');
	if (!Number.isFinite(radius)) error(400, 'Bad radius.');

	// Rounding to about a kilometre keeps the cache useful: everyone searching
	// from the same town shares one upstream request. Distances are measured
	// from the caller's exact position on the client anyway.
	const roundedLat = Number(lat.toFixed(2));
	const roundedLon = Number(lon.toFixed(2));
	const roundedRadius = Math.min(Math.max(Math.round(radius), MIN_RADIUS_M), MAX_RADIUS_M);
	const query = buildQuery(roundedLat, roundedLon, roundedRadius);

	let lastStatus = 0;
	let lastRemark = '';
	for (const endpoint of ENDPOINTS) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					'user-agent': USER_AGENT
				},
				body: new URLSearchParams({ data: query }),
				signal: controller.signal
			});
			if (!response.ok) {
				lastStatus = response.status;
				continue;
			}
			const body = (await response.json()) as OverpassBody;

			const health = looksHealthy(body);
			if (!health.ok) {
				lastRemark = health.reason;
				continue;
			}

			return json(body, {
				headers: {
					// Viewing spots barely change, so let the edge answer most hits.
					'cache-control': 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800',
					'x-upstream': new URL(endpoint).host
				}
			});
		} catch {
			// Try the next mirror.
		} finally {
			clearTimeout(timer);
		}
	}

	const detail = lastRemark
		? `OpenStreetMap's Overpass service did not answer usefully (${lastRemark}).`
		: lastStatus
			? `OpenStreetMap's Overpass service replied ${lastStatus}.`
			: 'Could not reach OpenStreetMap.';
	error(503, `${detail} It is a free shared service — try again in a minute, or a smaller radius.`);
};
