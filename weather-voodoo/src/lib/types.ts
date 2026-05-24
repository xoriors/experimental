import type { Locale } from './i18n/index.svelte';

export type LatLng = { lat: number; lon: number };

export type LabeledPoint = LatLng & { label?: string };

export type Tab = 'route' | 'fixed' | 'waypoints';
export type DayKey = 'today' | 'tomorrow' | 'd2';
export type TripMode = 'sea' | 'land';

export type DayOverride = {
	min: number | null;
	max: number | null;
	durationH: number | null;
	mode: TripMode | null;
};

export type ViewState = {
	tab: Tab;
	from: LabeledPoint | null;
	to: LabeledPoint | null;
	at: LabeledPoint | null;
	waypoints: LabeledPoint[];
	day: DayKey;
	expanded: Set<string>;
	tripMode: TripMode;
	tripDurationH: number;
	tripMinMin: number;
	tripMaxMin: number;
	intervals: Record<DayKey, DayOverride>;
	highlight: string | null;
	locale: Locale;
};

export type ForecastHour = {
	time: string;
	tempC: number;
	apparentC: number;
	precipMmH: number;
	rainMmH: number;
	showersMmH: number;
	pop: number;
	weatherCode: number;
	cloudPct: number;
	visKm: number;
	windKn: number;
	gustKn: number;
	windDirDeg: number;
	humidityPct: number;
	pressureHpa: number;
	uv?: number;
};

export type MarineHour = {
	time: string;
	waveHsM: number | null;
	waveDirDeg: number | null;
	wavePeriodS: number | null;
	swellHsM: number | null;
	swellDirDeg: number | null;
	swellPeriodS: number | null;
};

export type FusedHour = ForecastHour & {
	waveHsM: number | null;
	wavePeriodS: number | null;
	swellHsM: number | null;
	/**
	 * Wind angle relative to the direction of travel, in [-180, 180]. Only
	 * present for route-based forecasts (where a heading exists); omitted for
	 * the Fixed Location view. See `$lib/wind`.
	 */
	relWindDeg?: number;
};

export type DaylightDay = { date: string; sunrise: string; sunset: string };

export type Activity =
	| 'swimming'
	| 'sunbathing'
	| 'hiking'
	| 'kayaking'
	| 'ferryOrBoat'
	| 'photography'
	| 'sightseeing';

export type Verdict = 'good' | 'ok' | 'poor' | 'unsafe';
