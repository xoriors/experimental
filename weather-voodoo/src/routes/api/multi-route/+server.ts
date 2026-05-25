import { error, json } from '@sveltejs/kit';
import { fetchForecast, fetchMarine } from '$lib/server/openmeteo';
import { computeSeaRoute } from '$lib/server/sea-routing';
import { computeFerryRoute } from '$lib/server/osm-ferry';
import { fuseRoute } from '$lib/fusion';
import { bearing, sampleAlongPolylineWithHeadings, sampleAlongRoute } from '$lib/geo';
import type { LatLng } from '$lib/types';
import type { RequestHandler } from './$types';

function parsePoints(raw: string | null): LatLng[] | null {
	if (!raw) return null;
	const out: LatLng[] = [];
	for (const seg of raw.split('|')) {
		const parts = seg.split(',');
		if (parts.length !== 2) return null;
		const lat = Number(parts[0]);
		const lon = Number(parts[1]);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
		out.push({ lat, lon });
	}
	return out;
}

type LegKind = 'ferry' | 'sea' | 'straight';
type Leg = { kind: LegKind; polyline: LatLng[]; lengthKm: number };

async function resolveLeg(from: LatLng, to: LatLng, land: boolean): Promise<Leg> {
	if (!land) {
		const ferry = await computeFerryRoute(from, to);
		if (ferry.ok) {
			return { kind: 'ferry', polyline: ferry.result.polyline, lengthKm: ferry.result.lengthKm };
		}
		const sea = computeSeaRoute(from, to);
		if (sea) {
			return { kind: 'sea', polyline: sea.polyline, lengthKm: sea.lengthKm };
		}
	}
	// Straight-line fallback (or always for land mode).
	const segment = [from, to];
	let lengthKm = 0;
	for (let i = 1; i < segment.length; i++) {
		const a = segment[i - 1];
		const b = segment[i];
		const r = (x: number) => (x * Math.PI) / 180;
		const dLat = r(b.lat - a.lat);
		const dLon = r(b.lon - a.lon);
		const lat1 = r(a.lat);
		const lat2 = r(b.lat);
		const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
		lengthKm += 2 * 6371 * Math.asin(Math.sqrt(h));
	}
	return { kind: 'straight', polyline: segment, lengthKm };
}

export const GET: RequestHandler = async ({ url }) => {
	const points = parsePoints(url.searchParams.get('pts'));
	if (!points || points.length < 2) throw error(400, 'pts=lat,lon|lat,lon|... required, at least 2 points');
	const samples = Math.min(Math.max(Number(url.searchParams.get('samples') ?? '3'), 2), 7);
	const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? '3'), 1), 5);
	const land = url.searchParams.get('land') === '1';

	// Resolve each consecutive leg in parallel.
	const legs = await Promise.all(
		points.slice(0, -1).map((p, i) => resolveLeg(p, points[i + 1], land))
	);

	// Concatenate polylines, dropping the duplicate join point between segments.
	const polyline: LatLng[] = [];
	for (let i = 0; i < legs.length; i++) {
		const leg = legs[i];
		if (i === 0) polyline.push(...leg.polyline);
		else polyline.push(...leg.polyline.slice(1));
	}

	const totalKm = legs.reduce((acc, l) => acc + l.lengthKm, 0);
	const ferryLegs = legs.filter((l) => l.kind === 'ferry').length;
	const seaLegs = legs.filter((l) => l.kind === 'sea').length;
	const straightLegs = legs.filter((l) => l.kind === 'straight').length;

	const allStraight = legs.every((l) => l.kind === 'straight');
	let samplePoints: LatLng[];
	let sampleHeadings: number[];
	if (allStraight) {
		samplePoints = sampleAlongRoute(points[0], points[points.length - 1], samples);
		const h = bearing(points[0], points[points.length - 1]);
		sampleHeadings = samplePoints.map(() => h);
	} else {
		const sampled = sampleAlongPolylineWithHeadings(polyline, samples);
		samplePoints = sampled.points;
		sampleHeadings = sampled.headings;
	}

	try {
		const results = await Promise.all(
			samplePoints.map(async (p, i) => {
				const [f, m] = await Promise.all([
					fetchForecast(p.lat, p.lon, days),
					fetchMarine(p.lat, p.lon, days)
				]);
				return {
					forecast: f.hours,
					marine: m?.hours ?? null,
					timezone: f.timezone,
					daylight: f.daylight,
					headingDeg: sampleHeadings[i]
				};
			})
		);
		const hours = fuseRoute(results);
		const windSamples = results.map((r, i) => ({
			point: samplePoints[i],
			headingDeg: sampleHeadings[i],
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
				samplePoints,
				hours,
				daylight: results[0]?.daylight ?? [],
				polyline,
				windSamples,
				route: {
					kind: 'waypoints',
					legCount: legs.length,
					ferryLegs,
					seaLegs,
					straightLegs,
					totalKm
				}
			},
			{ headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' } }
		);
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'upstream error');
	}
};
