import type { DaylightDay } from './types';

export function dayLookup(daylight: DaylightDay[]): Map<string, DaylightDay> {
	const m = new Map<string, DaylightDay>();
	for (const d of daylight) m.set(d.date, d);
	return m;
}

export function isDaylight(time: string, daylight: DaylightDay | undefined): boolean {
	if (!daylight) return true;
	const sr = daylight.sunrise;
	const ss = daylight.sunset;
	if (!sr || !ss) return true;
	return time >= sr && time < ss;
}

export type SunPhase = 'pre-dawn' | 'sunrise-hour' | 'day' | 'sunset-hour' | 'night';

export function sunPhase(time: string, daylight: DaylightDay | undefined): SunPhase {
	if (!daylight) return 'day';
	const sr = daylight.sunrise;
	const ss = daylight.sunset;
	if (!sr || !ss) return 'day';
	const sameHour = (a: string, b: string) => a.slice(0, 13) === b.slice(0, 13);
	if (sameHour(time, sr)) return 'sunrise-hour';
	if (sameHour(time, ss)) return 'sunset-hour';
	if (time < sr) return 'pre-dawn';
	if (time >= ss) return 'night';
	return 'day';
}
