import { describe, it, expect } from 'vitest';
import { sortForDisplay, trimRecents, type SavedPlace } from '../src/lib/client/recentPlaces.svelte';

function mk(overrides: Partial<SavedPlace>): SavedPlace {
	return {
		lat: 0,
		lon: 0,
		label: 'X',
		pinned: false,
		lastUsed: 0,
		...overrides
	};
}

describe('sortForDisplay', () => {
	it('puts pinned before recent regardless of lastUsed', () => {
		const items = [
			mk({ label: 'recent-newer', lastUsed: 200 }),
			mk({ label: 'pinned-older', pinned: true, lastUsed: 50 }),
			mk({ label: 'recent-older', lastUsed: 100 })
		];
		const order = sortForDisplay(items).map((p) => p.label);
		expect(order).toEqual(['pinned-older', 'recent-newer', 'recent-older']);
	});

	it('orders by lastUsed within each group, newest first', () => {
		const items = [
			mk({ label: 'pin-A', pinned: true, lastUsed: 100 }),
			mk({ label: 'pin-B', pinned: true, lastUsed: 300 }),
			mk({ label: 'r-A', lastUsed: 1000 }),
			mk({ label: 'r-B', lastUsed: 999 })
		];
		const order = sortForDisplay(items).map((p) => p.label);
		expect(order).toEqual(['pin-B', 'pin-A', 'r-A', 'r-B']);
	});
});

describe('trimRecents', () => {
	it('keeps all pinned even when there are many', () => {
		const items: SavedPlace[] = Array.from({ length: 20 }, (_, i) =>
			mk({ label: `pin-${i}`, pinned: true, lat: i, lastUsed: i })
		);
		const out = trimRecents(items, 5);
		expect(out).toHaveLength(20);
		expect(out.every((p) => p.pinned)).toBe(true);
	});

	it('evicts the oldest recents past the cap', () => {
		const items: SavedPlace[] = [
			mk({ label: 'old', lastUsed: 1, lat: 1 }),
			mk({ label: 'mid', lastUsed: 5, lat: 2 }),
			mk({ label: 'new', lastUsed: 10, lat: 3 })
		];
		const out = trimRecents(items, 2);
		const labels = out.map((p) => p.label).sort();
		expect(labels).toEqual(['mid', 'new']);
	});

	it('combines pinned + capped recents', () => {
		const items: SavedPlace[] = [
			mk({ label: 'pin', pinned: true, lat: 0, lastUsed: 1 }),
			mk({ label: 'old', lat: 1, lastUsed: 1 }),
			mk({ label: 'mid', lat: 2, lastUsed: 5 }),
			mk({ label: 'new', lat: 3, lastUsed: 10 })
		];
		const out = trimRecents(items, 2);
		expect(out).toHaveLength(3);
		const labels = out.map((p) => p.label).sort();
		expect(labels).toEqual(['mid', 'new', 'pin']);
	});
});
