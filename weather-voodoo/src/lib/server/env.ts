import { env } from '$env/dynamic/private';

export function openWeatherKey(): string | null {
	const k = env.OPENWEATHER_API_KEY;
	if (!k || k.trim().length === 0) return null;
	return k;
}
