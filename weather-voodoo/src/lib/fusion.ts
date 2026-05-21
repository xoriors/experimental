import type { ForecastHour, FusedHour, MarineHour } from './types';

type PointForecast = {
	forecast: ForecastHour[];
	marine?: MarineHour[] | null;
};

function maxOrNull(values: (number | null | undefined)[]): number | null {
	const filtered = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
	if (filtered.length === 0) return null;
	return Math.max(...filtered);
}

function minOrNull(values: (number | null | undefined)[]): number | null {
	const filtered = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
	if (filtered.length === 0) return null;
	return Math.min(...filtered);
}

function avg(values: number[]): number {
	return values.reduce((s, v) => s + v, 0) / values.length;
}

export function fuseRoute(points: PointForecast[]): FusedHour[] {
	if (points.length === 0) return [];

	const hourCount = Math.min(...points.map((p) => p.forecast.length));
	const out: FusedHour[] = [];

	for (let i = 0; i < hourCount; i++) {
		const hours = points.map((p) => p.forecast[i]);
		const marines = points.map((p) => p.marine?.[i] ?? null);
		const time = hours[0]?.time ?? '';

		out.push({
			time,
			tempC: avg(hours.map((h) => h.tempC)),
			apparentC: avg(hours.map((h) => h.apparentC)),
			precipMmH: Math.max(...hours.map((h) => h.precipMmH)),
			rainMmH: Math.max(...hours.map((h) => h.rainMmH)),
			showersMmH: Math.max(...hours.map((h) => h.showersMmH)),
			pop: Math.max(...hours.map((h) => h.pop)),
			weatherCode: hours.map((h) => h.weatherCode).sort((a, b) => b - a)[0] ?? 0,
			cloudPct: Math.max(...hours.map((h) => h.cloudPct)),
			visKm: Math.min(...hours.map((h) => h.visKm)),
			windKn: Math.max(...hours.map((h) => h.windKn)),
			gustKn: Math.max(...hours.map((h) => h.gustKn)),
			windDirDeg: hours[0]?.windDirDeg ?? 0,
			humidityPct: avg(hours.map((h) => h.humidityPct)),
			pressureHpa: avg(hours.map((h) => h.pressureHpa)),
			uv: maxOrNull(hours.map((h) => h.uv)) ?? undefined,
			waveHsM: maxOrNull(marines.map((m) => m?.waveHsM ?? null)),
			wavePeriodS: maxOrNull(marines.map((m) => m?.wavePeriodS ?? null)),
			swellHsM: maxOrNull(marines.map((m) => m?.swellHsM ?? null))
		});

		void minOrNull;
	}

	return out;
}

export function mergeSinglePoint(forecast: ForecastHour[], marine?: MarineHour[] | null): FusedHour[] {
	return forecast.map((h, i) => {
		const m = marine?.[i] ?? null;
		return {
			...h,
			waveHsM: m?.waveHsM ?? null,
			wavePeriodS: m?.wavePeriodS ?? null,
			swellHsM: m?.swellHsM ?? null
		};
	});
}

export type ThreeHourAggregate = {
	startHour: number;
	hours: FusedHour[];
	agg: {
		tempC: number;
		windKn: number;
		gustKn: number;
		precipMmH: number;
		pop: number;
		waveHsM: number | null;
		visKm: number;
		weatherCode: number;
		cloudPct: number;
		uv: number | undefined;
	};
};

export function aggregate3h(hours: FusedHour[]): ThreeHourAggregate[] {
	const buckets = new Map<number, FusedHour[]>();
	for (const h of hours) {
		const match = /T(\d{2}):/.exec(h.time);
		const hr = match ? Number(match[1]) : 0;
		const slot = Math.floor(hr / 3) * 3;
		const arr = buckets.get(slot) ?? [];
		arr.push(h);
		buckets.set(slot, arr);
	}

	const slots = [...buckets.keys()].sort((a, b) => a - b);
	return slots.map((startHour) => {
		const bucket = buckets.get(startHour)!;
		return {
			startHour,
			hours: bucket,
			agg: {
				tempC: avg(bucket.map((h) => h.tempC)),
				windKn: Math.max(...bucket.map((h) => h.windKn)),
				gustKn: Math.max(...bucket.map((h) => h.gustKn)),
				precipMmH: Math.max(...bucket.map((h) => h.precipMmH)),
				pop: Math.max(...bucket.map((h) => h.pop)),
				waveHsM: maxOrNull(bucket.map((h) => h.waveHsM)),
				visKm: Math.min(...bucket.map((h) => h.visKm)),
				weatherCode: bucket.map((h) => h.weatherCode).sort((a, b) => b - a)[0] ?? 0,
				cloudPct: Math.max(...bucket.map((h) => h.cloudPct)),
				uv: maxOrNull(bucket.map((h) => h.uv ?? null)) ?? undefined
			}
		};
	});
}
