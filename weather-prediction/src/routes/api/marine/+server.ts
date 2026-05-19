import { error, json } from '@sveltejs/kit';
import { fetchMarine } from '$lib/server/openmeteo';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const lat = Number(url.searchParams.get('lat'));
	const lon = Number(url.searchParams.get('lon'));
	const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? '3'), 1), 7);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw error(400, 'Invalid lat/lon');
	const data = await fetchMarine(lat, lon, days);
	return json(data ?? { timezone: 'UTC', hours: [] }, {
		headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' }
	});
};
