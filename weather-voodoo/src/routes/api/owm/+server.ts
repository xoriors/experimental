import { error, json } from '@sveltejs/kit';
import { fetchAir, fetchOneCall } from '$lib/server/openweather';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const lat = Number(url.searchParams.get('lat'));
	const lon = Number(url.searchParams.get('lon'));
	const kind = url.searchParams.get('kind') ?? 'onecall';
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw error(400, 'Invalid lat/lon');

	if (kind === 'onecall') {
		const data = await fetchOneCall(lat, lon);
		return json(data, {
			headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' }
		});
	}
	if (kind === 'air') {
		const data = await fetchAir(lat, lon);
		return json(data, {
			headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' }
		});
	}
	throw error(400, 'kind must be onecall or air');
};
