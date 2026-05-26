import { error, json } from '@sveltejs/kit';
import { fetchForecast, fetchMarine } from '$lib/server/openmeteo';
import { computeSeaRoute } from '$lib/server/sea-routing';
import { computeFerryRoute } from '$lib/server/osm-ferry';
import { computeLandTrailRoute } from '$lib/server/osm-land';
import { fuseRoute } from '$lib/fusion';
import { bearing, sampleAlongPolylineWithHeadings, sampleAlongRoute } from '$lib/geo';
import type { LatLng } from '$lib/types';
import type { RequestHandler } from './$types';

function parsePoint(raw: string | null): { lat: number; lon: number } | null {
	if (!raw) return null;
	const parts = raw.split(',');
	if (parts.length !== 2) return null;
	const lat = Number(parts[0]);
	const lon = Number(parts[1]);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	return { lat, lon };
}

export const GET: RequestHandler = async ({ url }) => {
	const from = parsePoint(url.searchParams.get('from'));
	const to = parsePoint(url.searchParams.get('to'));
	if (!from || !to) throw error(400, 'from and to required as lat,lon');
	const samples = Math.min(Math.max(Number(url.searchParams.get('samples') ?? '3'), 2), 7);
	const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? '3'), 1), 5);
	const land = url.searchParams.get('land') === '1';

	type RouteMeta =
		| { kind: 'ferry'; lengthKm: number; wayCount: number; originSnapKm: number; destinationSnapKm: number }
		| { kind: 'sea'; lengthKm: number; greatCircleKm: number; detourRatio: number }
		| { kind: 'trail'; lengthKm: number; wayCount: number; hikeWayCount: number; bikeWayCount: number; originSnapKm: number; destinationSnapKm: number }
		| { kind: 'straight'; ferryFallback?: string; ferryDetail?: string; trailFallback?: string; trailDetail?: string };

	let routePolyline: LatLng[] = [from, to];
	let routeMeta: RouteMeta = { kind: 'straight' };

	if (land) {
		const trail = await computeLandTrailRoute(from, to);
		if (trail.ok) {
			routePolyline = trail.result.polyline;
			routeMeta = {
				kind: 'trail',
				lengthKm: trail.result.lengthKm,
				wayCount: trail.result.wayCount,
				hikeWayCount: trail.result.hikeWayCount,
				bikeWayCount: trail.result.bikeWayCount,
				originSnapKm: trail.result.originSnapKm,
				destinationSnapKm: trail.result.destinationSnapKm
			};
		} else {
			routeMeta = { kind: 'straight', trailFallback: trail.reason, trailDetail: trail.detail };
		}
	} else if (!land) {
		// Prefer OSM ferry routing — uses real `route=ferry` tagging from
		// OpenStreetMap, which is dense enough for short coastal hops where
		// the Eurostat marnet is too coarse.
		const ferry = await computeFerryRoute(from, to);
		if (ferry.ok) {
			routePolyline = ferry.result.polyline;
			routeMeta = {
				kind: 'ferry',
				lengthKm: ferry.result.lengthKm,
				wayCount: ferry.result.wayCount,
				originSnapKm: ferry.result.originSnapKm,
				destinationSnapKm: ferry.result.destinationSnapKm
			};
		} else {
			const sea = computeSeaRoute(from, to);
			if (sea) {
				routePolyline = sea.polyline;
				routeMeta = {
					kind: 'sea',
					lengthKm: sea.lengthKm,
					greatCircleKm: sea.greatCircleKm,
					detourRatio: sea.detourRatio
				};
			} else {
				routeMeta = {
					kind: 'straight',
					ferryFallback: ferry.reason,
					ferryDetail: ferry.detail
				};
			}
		}
	}

	let points: LatLng[];
	let headings: number[];
	if (routeMeta.kind === 'straight') {
		points = sampleAlongRoute(from, to, samples);
		// Constant heading for a straight-line route.
		const h = bearing(from, to);
		headings = points.map(() => h);
	} else {
		const sampled = sampleAlongPolylineWithHeadings(routePolyline, samples);
		points = sampled.points;
		headings = sampled.headings;
	}

	try {
		const results = await Promise.all(
			points.map(async (p, i) => {
				const [f, m] = await Promise.all([fetchForecast(p.lat, p.lon, days), fetchMarine(p.lat, p.lon, days)]);
				return {
					forecast: f.hours,
					marine: m?.hours ?? null,
					timezone: f.timezone,
					daylight: f.daylight,
					headingDeg: headings[i]
				};
			})
		);
		const hours = fuseRoute(results);
		const windSamples = results.map((r, i) => ({
			point: points[i],
			headingDeg: headings[i],
			hours: r.forecast.map((h) => ({
				time: h.time,
				windDirDeg: h.windDirDeg,
				windKn: h.windKn,
				gustKn: h.gustKn
			}))
		}));
		return json(
			{
				timezone: results[0]?.timezone ?? 'UTC',
				samplePoints: points,
				hours,
				daylight: results[0]?.daylight ?? [],
				polyline: routePolyline,
				route: routeMeta,
				windSamples
			},
			{ headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' } }
		);
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'upstream error');
	}
};
