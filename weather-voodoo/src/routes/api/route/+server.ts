import { error, json } from '@sveltejs/kit';
import { fetchForecast, fetchMarine } from '$lib/server/openmeteo';
import { computeSeaRoute } from '$lib/server/sea-routing';
import { computeFerryRoute } from '$lib/server/osm-ferry';
import { fuseRoute } from '$lib/fusion';
import { sampleAlongPolyline, sampleAlongRoute } from '$lib/geo';
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
		| { kind: 'straight' };

	let routePolyline: LatLng[] = [from, to];
	let routeMeta: RouteMeta = { kind: 'straight' };

	if (!land) {
		// Prefer OSM ferry routing — uses real `route=ferry` tagging from
		// OpenStreetMap, which is dense enough for short coastal hops where
		// the Eurostat marnet is too coarse.
		const ferry = await computeFerryRoute(from, to);
		if (ferry) {
			routePolyline = ferry.polyline;
			routeMeta = {
				kind: 'ferry',
				lengthKm: ferry.lengthKm,
				wayCount: ferry.wayCount,
				originSnapKm: ferry.originSnapKm,
				destinationSnapKm: ferry.destinationSnapKm
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
			}
		}
	}

	const points =
		routeMeta.kind === 'straight'
			? sampleAlongRoute(from, to, samples)
			: sampleAlongPolyline(routePolyline, samples);

	try {
		const results = await Promise.all(
			points.map(async (p) => {
				const [f, m] = await Promise.all([fetchForecast(p.lat, p.lon, days), fetchMarine(p.lat, p.lon, days)]);
				return { forecast: f.hours, marine: m?.hours ?? null, timezone: f.timezone, daylight: f.daylight };
			})
		);
		const hours = fuseRoute(results);
		return json(
			{
				timezone: results[0]?.timezone ?? 'UTC',
				samplePoints: points,
				hours,
				daylight: results[0]?.daylight ?? [],
				polyline: routePolyline,
				route: routeMeta
			},
			{ headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' } }
		);
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'upstream error');
	}
};
