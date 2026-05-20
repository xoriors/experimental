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

export function localIsoDate(d: Date = new Date()): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function isoOfDayOffset(reference: Date, offset: number): string {
	const d = new Date(reference);
	d.setDate(d.getDate() + offset);
	return localIsoDate(d);
}

export function filterHoursForDay<T extends { time: string }>(
	hours: T[],
	day: DayKey,
	referenceIso: string
): T[] {
	const [yy, mm, dd] = referenceIso.split('-').map(Number);
	const target = new Date(yy, (mm ?? 1) - 1, dd ?? 1);
	target.setDate(target.getDate() + dayOffset(day));
	const targetDate = localIsoDate(target);
	return hours.filter((h) => dateOfIso(h.time) === targetDate);
}
