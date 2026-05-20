import { cached, roundCoord } from './cache';
import { openWeatherKey } from './env';

const ONECALL_URL = 'https://api.openweathermap.org/data/3.0/onecall';
const AIR_URL = 'https://api.openweathermap.org/data/2.5/air_pollution';

export type OwmAlert = { event: string; description: string; start: number; end: number; sender: string };

export type OwmOneCall = {
	available: true;
	uvIndexCurrent: number | null;
	uvIndexHourly: { time: number; uv: number }[];
	alerts: OwmAlert[];
} | { available: false; reason: string };

export type OwmAir = {
	available: true;
	aqi: number;
	pm25: number;
	pm10: number;
} | { available: false; reason: string };

export async function fetchOneCall(lat: number, lon: number): Promise<OwmOneCall> {
	const key = openWeatherKey();
	if (!key) return { available: false, reason: 'OPENWEATHER_API_KEY not set' };
	const rLat = roundCoord(lat);
	const rLon = roundCoord(lon);
	const cacheKey = `owm:onecall:${rLat}:${rLon}`;
	try {
		return await cached(cacheKey, async () => {
			const params = new URLSearchParams({
				lat: rLat.toString(),
				lon: rLon.toString(),
				exclude: 'minutely,daily',
				units: 'metric',
				appid: key
			});
			const res = await fetch(`${ONECALL_URL}?${params.toString()}`);
			if (!res.ok) {
				return { available: false, reason: `OpenWeather One Call HTTP ${res.status} — check subscription (3.0 requires paid plan)` };
			}
			const data = (await res.json()) as {
				current?: { uvi?: number };
				hourly?: { dt: number; uvi?: number }[];
				alerts?: { event: string; description: string; start: number; end: number; sender_name: string }[];
			};
			return {
				available: true,
				uvIndexCurrent: data.current?.uvi ?? null,
				uvIndexHourly: (data.hourly ?? []).map((h) => ({ time: h.dt, uv: h.uvi ?? 0 })),
				alerts: (data.alerts ?? []).map((a) => ({
					event: a.event,
					description: a.description,
					start: a.start,
					end: a.end,
					sender: a.sender_name
				}))
			};
		});
	} catch (e) {
		return { available: false, reason: e instanceof Error ? e.message : 'fetch failed' };
	}
}

export async function fetchAir(lat: number, lon: number): Promise<OwmAir> {
	const key = openWeatherKey();
	if (!key) return { available: false, reason: 'OPENWEATHER_API_KEY not set' };
	const rLat = roundCoord(lat);
	const rLon = roundCoord(lon);
	const cacheKey = `owm:air:${rLat}:${rLon}`;
	try {
		return await cached(cacheKey, async () => {
			const params = new URLSearchParams({
				lat: rLat.toString(),
				lon: rLon.toString(),
				appid: key
			});
			const res = await fetch(`${AIR_URL}?${params.toString()}`);
			if (!res.ok) return { available: false, reason: `OpenWeather air HTTP ${res.status}` };
			const data = (await res.json()) as {
				list?: { main?: { aqi?: number }; components?: { pm2_5?: number; pm10?: number } }[];
			};
			const first = data.list?.[0];
			return {
				available: true,
				aqi: first?.main?.aqi ?? 0,
				pm25: first?.components?.pm2_5 ?? 0,
				pm10: first?.components?.pm10 ?? 0
			};
		});
	} catch (e) {
		return { available: false, reason: e instanceof Error ? e.message : 'fetch failed' };
	}
}
