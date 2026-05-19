import type { DayKey } from './types';

export function dayOffset(day: DayKey): number {
	if (day === 'today') return 0;
	if (day === 'tomorrow') return 1;
	return 2;
}

export function slotKey(hour: number): string {
	return hour.toString().padStart(2, '0');
}

export const THREE_HOUR_SLOTS = [0, 3, 6, 9, 12, 15, 18, 21] as const;

export function hourOfIso(iso: string): number {
	const match = /T(\d{2}):/.exec(iso);
	if (!match) return 0;
	return Number(match[1]);
}

export function dateOfIso(iso: string): string {
	return iso.slice(0, 10);
}

export function isoOfDayOffset(reference: Date, offset: number): string {
	const d = new Date(reference);
	d.setDate(d.getDate() + offset);
	return d.toISOString().slice(0, 10);
}

export function filterHoursForDay<T extends { time: string }>(
	hours: T[],
	day: DayKey,
	referenceIso: string
): T[] {
	const target = new Date(referenceIso);
	target.setDate(target.getDate() + dayOffset(day));
	const targetDate = target.toISOString().slice(0, 10);
	return hours.filter((h) => dateOfIso(h.time) === targetDate);
}
