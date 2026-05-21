import type { LabeledPoint } from '$lib/types';

export type SavedPlace = LabeledPoint & {
	label: string;
	pinned: boolean;
	lastUsed: number;
};

const STORAGE_KEY = 'wv.places.v1';
const MAX_RECENT = 8;
const COORD_PRECISION = 4;

function roundCoord(n: number): number {
	const p = 10 ** COORD_PRECISION;
	return Math.round(n * p) / p;
}

function sameSpot(a: SavedPlace, b: { lat: number; lon: number }): boolean {
	return roundCoord(a.lat) === roundCoord(b.lat) && roundCoord(a.lon) === roundCoord(b.lon);
}

function read(): SavedPlace[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((p): p is SavedPlace => {
				if (!p || typeof p !== 'object') return false;
				const o = p as Record<string, unknown>;
				return (
					typeof o.lat === 'number' &&
					typeof o.lon === 'number' &&
					typeof o.label === 'string' &&
					typeof o.pinned === 'boolean' &&
					typeof o.lastUsed === 'number'
				);
			})
			.slice(0, 64);
	} catch {
		return [];
	}
}

function write(places: SavedPlace[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
	} catch {
		// quota / private mode — ignore
	}
}

export function sortForDisplay(places: SavedPlace[]): SavedPlace[] {
	return [...places].sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		return b.lastUsed - a.lastUsed;
	});
}

export function trimRecents(places: SavedPlace[], maxRecent = MAX_RECENT): SavedPlace[] {
	const pinned = places.filter((p) => p.pinned);
	const recents = places
		.filter((p) => !p.pinned)
		.sort((a, b) => b.lastUsed - a.lastUsed)
		.slice(0, maxRecent);
	return [...pinned, ...recents];
}

export const places = $state<{ items: SavedPlace[] }>({ items: [] });

export function loadPlaces(): void {
	places.items = read();
}

export function addRecent(p: LabeledPoint): void {
	const label = p.label?.trim() || `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
	const existing = places.items.find((x) => sameSpot(x, p));
	const now = Date.now();
	let next: SavedPlace[];
	if (existing) {
		next = places.items.map((x) =>
			sameSpot(x, p) ? { ...x, label, lastUsed: now } : x
		);
	} else {
		const fresh: SavedPlace = {
			lat: p.lat,
			lon: p.lon,
			label,
			pinned: false,
			lastUsed: now
		};
		next = [fresh, ...places.items];
	}
	places.items = trimRecents(next);
	write(places.items);
}

export function togglePin(target: { lat: number; lon: number }): void {
	const next = places.items.map((x) =>
		sameSpot(x, target) ? { ...x, pinned: !x.pinned } : x
	);
	places.items = trimRecents(next);
	write(places.items);
}

export function removePlace(target: { lat: number; lon: number }): void {
	places.items = places.items.filter((x) => !sameSpot(x, target));
	write(places.items);
}

export function clearAll(): void {
	places.items = [];
	write(places.items);
}
