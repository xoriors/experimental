import { json } from '@sveltejs/kit';
import { geocode } from '$lib/server/openmeteo';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const results = await geocode(q);
	return json(
		{ results },
		{ headers: { 'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400' } }
	);
};
