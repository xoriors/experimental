export type LatLng = { lat: number; lon: number };

export type LabeledPoint = LatLng & { label?: string };

export type Tab = 'route' | 'fixed';
export type DayKey = 'today' | 'tomorrow' | 'd2';
export type TripMode = 'auto' | 'sea' | 'land';

export type DayInterval = { min: number | null; max: number | null };

export type ViewState = {
	tab: Tab;
	from: LabeledPoint | null;
	to: LabeledPoint | null;
	at: LabeledPoint | null;
	day: DayKey;
	expanded: Set<string>;
	tripMode: TripMode;
	tripDurationH: number;
	tripMinHour: number;
	tripMaxHour: number;
	intervals: Record<DayKey, DayInterval>;
	highlight: string | null;
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
};

export type Activity =
	| 'swimming'
	| 'sunbathing'
	| 'hiking'
	| 'kayaking'
	| 'ferryOrBoat'
	| 'photography'
	| 'sightseeing';

export type Verdict = 'good' | 'ok' | 'poor' | 'unsafe';
