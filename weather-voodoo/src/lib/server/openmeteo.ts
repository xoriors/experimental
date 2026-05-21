import type { ForecastHour, MarineHour } from '../types';
import { cached, roundCoord } from './cache';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

const FORECAST_VARS = [
	'temperature_2m',
	'apparent_temperature',
	'precipitation_probability',
	'precipitation',
	'rain',
	'showers',
	'weather_code',
	'cloud_cover',
	'visibility',
	'wind_speed_10m',
	'wind_direction_10m',
	'wind_gusts_10m',
	'relative_humidity_2m',
	'surface_pressure',
	'uv_index'
].join(',');

const MARINE_VARS = [
	'wave_height',
	'wave_direction',
	'wave_period',
	'swell_wave_height',
	'swell_wave_direction',
	'swell_wave_period'
].join(',');

function buildForecastUrl(lat: number, lon: number, days: number): string {
	const params = new URLSearchParams({
		latitude: lat.toString(),
		longitude: lon.toString(),
		hourly: FORECAST_VARS,
		daily: 'sunrise,sunset',
		forecast_days: days.toString(),
		timezone: 'auto',
		wind_speed_unit: 'kn'
	});
	return `${FORECAST_URL}?${params.toString()}`;
}

function buildMarineUrl(lat: number, lon: number, days: number): string {
	const params = new URLSearchParams({
		latitude: lat.toString(),
		longitude: lon.toString(),
		hourly: MARINE_VARS,
		forecast_days: days.toString(),
		timezone: 'auto',
		length_unit: 'metric'
	});
	return `${MARINE_URL}?${params.toString()}`;
}

type RawForecast = {
	timezone?: string;
	hourly?: {
		time: string[];
		temperature_2m: number[];
		apparent_temperature: number[];
		precipitation_probability: (number | null)[];
		precipitation: number[];
		rain: number[];
		showers: number[];
		weather_code: number[];
		cloud_cover: number[];
		visibility: number[];
		wind_speed_10m: number[];
		wind_direction_10m: number[];
		wind_gusts_10m: number[];
		relative_humidity_2m: number[];
		surface_pressure: number[];
		uv_index?: (number | null)[];
	};
	daily?: {
		time: string[];
		sunrise: string[];
		sunset: string[];
	};
};

type RawMarine = {
	timezone?: string;
	hourly?: {
		time: string[];
		wave_height: (number | null)[];
		wave_direction: (number | null)[];
		wave_period: (number | null)[];
		swell_wave_height: (number | null)[];
		swell_wave_direction: (number | null)[];
		swell_wave_period: (number | null)[];
	};
};

export type DaylightDay = { date: string; sunrise: string; sunset: string };
export type ForecastResult = { timezone: string; hours: ForecastHour[]; daylight: DaylightDay[] };
export type MarineResult = { timezone: string; hours: MarineHour[] } | null;

export async function fetchForecast(lat: number, lon: number, days = 3): Promise<ForecastResult> {
	const rLat = roundCoord(lat);
	const rLon = roundCoord(lon);
	const key = `forecast:${rLat}:${rLon}:${days}`;
	return cached(key, async () => {
		const url = buildForecastUrl(rLat, rLon, days);
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Open-Meteo forecast HTTP ${res.status}`);
		const data = (await res.json()) as RawForecast;
		const h = data.hourly;
		const d = data.daily;
		const daylight: DaylightDay[] = d
			? d.time.map((date, i) => ({
					date,
					sunrise: d.sunrise[i] ?? '',
					sunset: d.sunset[i] ?? ''
				}))
			: [];
		if (!h) return { timezone: data.timezone ?? 'UTC', hours: [], daylight };

		const hours: ForecastHour[] = h.time.map((t, i) => ({
			time: t,
			tempC: h.temperature_2m[i] ?? 0,
			apparentC: h.apparent_temperature[i] ?? 0,
			precipMmH: h.precipitation[i] ?? 0,
			rainMmH: h.rain[i] ?? 0,
			showersMmH: h.showers[i] ?? 0,
			pop: h.precipitation_probability[i] ?? 0,
			weatherCode: h.weather_code[i] ?? 0,
			cloudPct: h.cloud_cover[i] ?? 0,
			visKm: (h.visibility[i] ?? 0) / 1000,
			windKn: h.wind_speed_10m[i] ?? 0,
			gustKn: h.wind_gusts_10m[i] ?? 0,
			windDirDeg: h.wind_direction_10m[i] ?? 0,
			humidityPct: h.relative_humidity_2m[i] ?? 0,
			pressureHpa: h.surface_pressure[i] ?? 0,
			uv: h.uv_index?.[i] ?? undefined
		}));
		return { timezone: data.timezone ?? 'UTC', hours, daylight };
	});
}

export async function fetchMarine(lat: number, lon: number, days = 3): Promise<MarineResult> {
	const rLat = roundCoord(lat);
	const rLon = roundCoord(lon);
	const key = `marine:${rLat}:${rLon}:${days}`;
	try {
		return await cached(key, async () => {
			const url = buildMarineUrl(rLat, rLon, days);
			const res = await fetch(url);
			if (!res.ok) {
				if (res.status === 400) return null;
				throw new Error(`Open-Meteo marine HTTP ${res.status}`);
			}
			const data = (await res.json()) as RawMarine;
			const h = data.hourly;
			if (!h) return null;
			const hours: MarineHour[] = h.time.map((t, i) => ({
				time: t,
				waveHsM: h.wave_height[i] ?? null,
				waveDirDeg: h.wave_direction[i] ?? null,
				wavePeriodS: h.wave_period[i] ?? null,
				swellHsM: h.swell_wave_height[i] ?? null,
				swellDirDeg: h.swell_wave_direction[i] ?? null,
				swellPeriodS: h.swell_wave_period[i] ?? null
			}));
			return { timezone: data.timezone ?? 'UTC', hours };
		});
	} catch {
		return null;
	}
}

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

export type GeocodeResult = { name: string; lat: number; lon: number; country?: string; admin1?: string };

export async function geocode(query: string, limit = 5): Promise<GeocodeResult[]> {
	if (!query.trim()) return [];
	const params = new URLSearchParams({
		name: query,
		count: limit.toString(),
		language: 'en',
		format: 'json'
	});
	const res = await fetch(`${GEOCODE_URL}?${params.toString()}`);
	if (!res.ok) return [];
	const data = (await res.json()) as { results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[] };
	return (data.results ?? []).map((r) => ({
		name: r.name,
		lat: r.latitude,
		lon: r.longitude,
		country: r.country,
		admin1: r.admin1
	}));
}
