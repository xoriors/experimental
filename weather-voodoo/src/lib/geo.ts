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

function polylineKmLengths(line: LatLng[]): { cumulative: number[]; total: number } {
	const cumulative: number[] = [0];
	for (let i = 1; i < line.length; i++) {
		cumulative.push(cumulative[i - 1] + haversineKm(line[i - 1], line[i]));
	}
	return { cumulative, total: cumulative[cumulative.length - 1] ?? 0 };
}

function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
	return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

export function sampleAlongPolyline(line: LatLng[], samples: number): LatLng[] {
	if (line.length === 0) return [];
	if (line.length === 1) return Array(samples).fill(line[0]);
	if (samples < 2) return [line[0], line[line.length - 1]];

	const { cumulative, total } = polylineKmLengths(line);
	if (total === 0) return Array(samples).fill(line[0]);

	const out: LatLng[] = [];
	for (let s = 0; s < samples; s++) {
		const target = (s / (samples - 1)) * total;
		// Find the segment containing the target distance
		let i = 1;
		while (i < cumulative.length - 1 && cumulative[i] < target) i++;
		const segStart = cumulative[i - 1];
		const segLen = cumulative[i] - segStart;
		const t = segLen === 0 ? 0 : (target - segStart) / segLen;
		out.push(interpolate(line[i - 1], line[i], t));
	}
	return out;
}
