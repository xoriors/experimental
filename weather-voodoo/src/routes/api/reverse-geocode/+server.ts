import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, fetch }) => {
	const lat = Number(url.searchParams.get('lat'));
	const lon = Number(url.searchParams.get('lon'));
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
		return json({ error: 'lat/lon required' }, { status: 400 });
	}

	const u = new URL('https://nominatim.openstreetmap.org/reverse');
	u.searchParams.set('format', 'jsonv2');
	u.searchParams.set('lat', String(lat));
	u.searchParams.set('lon', String(lon));
	u.searchParams.set('accept-language', 'en');
	u.searchParams.set('zoom', '14');

	const res = await fetch(u.toString(), {
		headers: { 'User-Agent': 'weather-voodoo (https://weather-voodoo.vercel.app)' }
	});
	if (!res.ok) {
		return json(
			{ error: 'reverse geocode failed', status: res.status },
			{ status: 502 }
		);
	}
	const data = (await res.json()) as {
		display_name?: string;
		name?: string;
		address?: Record<string, string>;
	};

	const a = data.address ?? {};
	const place =
		a.village ?? a.town ?? a.city ?? a.suburb ?? a.county ?? a.state ?? data.name ?? '';
	const region = a.state ?? a.region ?? '';
	const country = a.country ?? '';
	const label = [place, region, country].filter(Boolean).join(', ') || data.display_name || '';

	return json(
		{ label, raw: data.display_name ?? null },
		{ headers: { 'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800' } }
	);
};
