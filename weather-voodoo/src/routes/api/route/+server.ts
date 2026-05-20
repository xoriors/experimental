import { error, json } from '@sveltejs/kit';
import { fetchForecast, fetchMarine } from '$lib/server/openmeteo';
import { fuseRoute } from '$lib/fusion';
import { sampleAlongRoute } from '$lib/geo';
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

	const points = sampleAlongRoute(from, to, samples);

	try {
		const results = await Promise.all(
			points.map(async (p) => {
				const [f, m] = await Promise.all([fetchForecast(p.lat, p.lon, days), fetchMarine(p.lat, p.lon, days)]);
				return { forecast: f.hours, marine: m?.hours ?? null, timezone: f.timezone };
			})
		);
		const hours = fuseRoute(results);
		return json(
			{
				timezone: results[0]?.timezone ?? 'UTC',
				samplePoints: points,
				hours
			},
			{ headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' } }
		);
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'upstream error');
	}
};
