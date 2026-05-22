export function msToKn(ms: number): number {
	return ms * 1.94384;
}

export function kmhToKn(kmh: number): number {
	return kmh / 1.852;
}

export function mToKm(m: number): number {
	return m / 1000;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function degToCompass(deg: number): string {
	const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
	return COMPASS[idx];
}

export function beaufort(windKn: number): number {
	if (windKn < 1) return 0;
	if (windKn < 4) return 1;
	if (windKn < 7) return 2;
	if (windKn < 11) return 3;
	if (windKn < 17) return 4;
	if (windKn < 22) return 5;
	if (windKn < 28) return 6;
	if (windKn < 34) return 7;
	if (windKn < 41) return 8;
	if (windKn < 48) return 9;
	if (windKn < 56) return 10;
	if (windKn < 64) return 11;
	return 12;
}

export type SeaStateKey = 'calm' | 'smooth' | 'slight' | 'moderate' | 'rough' | 'veryRough' | 'high' | 'veryHigh';

export function seaStateKey(hs: number): SeaStateKey {
	if (hs < 0.1) return 'calm';
	if (hs < 0.5) return 'smooth';
	if (hs < 1.25) return 'slight';
	if (hs < 2.5) return 'moderate';
	if (hs < 4) return 'rough';
	if (hs < 6) return 'veryRough';
	if (hs < 9) return 'high';
	return 'veryHigh';
}

export function round1(n: number): number {
	return Math.round(n * 10) / 10;
}
