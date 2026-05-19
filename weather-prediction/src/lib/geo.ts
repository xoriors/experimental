import type { LatLng } from './types';

const R_EARTH_KM = 6371;

function toRad(deg: number): number {
	return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
	return (rad * 180) / Math.PI;
}

export function haversineKm(a: LatLng, b: LatLng): number {
	const dLat = toRad(b.lat - a.lat);
	const dLon = toRad(b.lon - a.lon);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * R_EARTH_KM * Math.asin(Math.sqrt(h));
}

export function midpoint(a: LatLng, b: LatLng): LatLng {
	const lat1 = toRad(a.lat);
	const lon1 = toRad(a.lon);
	const lat2 = toRad(b.lat);
	const dLon = toRad(b.lon - a.lon);
	const bx = Math.cos(lat2) * Math.cos(dLon);
	const by = Math.cos(lat2) * Math.sin(dLon);
	const lat = Math.atan2(
		Math.sin(lat1) + Math.sin(lat2),
		Math.sqrt((Math.cos(lat1) + bx) ** 2 + by ** 2)
	);
	const lon = lon1 + Math.atan2(by, Math.cos(lat1) + bx);
	return { lat: toDeg(lat), lon: toDeg(lon) };
}

export function sampleAlongRoute(from: LatLng, to: LatLng, samples: number): LatLng[] {
	if (samples < 2) return [from, to];
	const out: LatLng[] = [];
	for (let i = 0; i < samples; i++) {
		const f = i / (samples - 1);
		const lat = from.lat + (to.lat - from.lat) * f;
		const lon = from.lon + (to.lon - from.lon) * f;
		out.push({ lat, lon });
	}
	return out;
}
