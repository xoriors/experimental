import { error, json } from '@sveltejs/kit';
import { fetchForecast } from '$lib/server/openmeteo';
import type { RequestHandler } from './$types';

function parseLatLon(url: URL): { lat: number; lon: number } {
	const lat = Number(url.searchParams.get('lat'));
	const lon = Number(url.searchParams.get('lon'));
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw error(400, 'Invalid lat/lon');
	if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw error(400, 'Out-of-range lat/lon');
	return { lat, lon };
}

export const GET: RequestHandler = async ({ url }) => {
	const { lat, lon } = parseLatLon(url);
	const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? '3'), 1), 7);
	try {
		const data = await fetchForecast(lat, lon, days);
		return json(data, {
			headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' }
		});
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'upstream error');
	}
};
