import { describe, expect, it } from 'vitest';
import {
	boundingBox,
	buildQuery,
	clampRadius,
	MAX_RADIUS_M
} from '../src/lib/data/overpass-query';

/** Every spatial filter in a query, as its north–south half-width in metres. */
function halfWidths(query: string, lat = 47.66): number[] {
	return [...query.matchAll(/\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\);/g)].map((m) =>
		Math.round(((Number(m[3]) - Number(m[1])) / 2) * 111320)
	);
}

function clauses(query: string): string[] {
	return query
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => /^n(wr|ode)\[/.test(line));
}

describe('the Overpass query', () => {
	const at = { lat: 47.66, lon: 23.58 };

	it('bounds every clause with a box rather than a circle', () => {
		// This is the whole difference between the feature working and not.
		// `(around:25000,…)` puts the spatial test after the tag scan: the full
		// query took 14 s against OSM France and then gave up with nothing. The
		// same clauses as bounding boxes went through the spatial index and
		// returned 188 places in three seconds.
		const query = buildQuery(at.lat, at.lon, 30000);
		expect(query).not.toContain('around:');
		expect(clauses(query).every((clause) => /\(-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+\);$/.test(clause)))
			.toBe(true);
	});

	it('asks for the output in the order every instance parses', () => {
		// `out center tags 250` puts geometry before verbosity, which some parsers
		// reject outright. Verbosity, then geometry, then the limit.
		expect(buildQuery(at.lat, at.lon, 30000)).toMatch(/\nout tags center \d+;$/);
	});

	it('gives Overpass a runtime limit it can meet, not one it will hit', () => {
		const timeoutOf = (q: string) => Number(q.match(/\[timeout:(\d+)\]/)![1]);
		const full = timeoutOf(buildQuery(at.lat, at.lon, 30000, 'full'));
		const lean = timeoutOf(buildQuery(at.lat, at.lon, 30000, 'lean'));
		// Measured at about three seconds, so there is real headroom — but not so
		// much that a struggling instance holds a connection open for a minute.
		expect(full).toBeGreaterThanOrEqual(12);
		expect(full).toBeLessThanOrEqual(20);
		expect(lean).toBeLessThan(full);
	});

	it('keeps the everyday things close and only ranges wide for the rare ones', () => {
		// A 60 km box holds thousands of car parks and no more viewpoints worth
		// having, and asking for all of them is what makes a query too expensive.
		const query = buildQuery(at.lat, at.lon, 60000, 'full');
		const boxOf = (pattern: RegExp) =>
			Math.round(((Number(query.match(pattern)![3]) - Number(query.match(pattern)![1])) / 2) * 111320);

		const viewpoint = boxOf(/viewpoint"\]\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/);
		const parking = boxOf(/parking"\]\["name"\]\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/);
		const terrace = boxOf(/outdoor_seating.*?\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/);

		expect(viewpoint).toBeCloseTo(60000, -2);
		expect(parking).toBeLessThanOrEqual(20100);
		expect(terrace).toBeLessThanOrEqual(25100);
	});

	it('never widens a search the user asked to keep small', () => {
		for (const half of halfWidths(buildQuery(at.lat, at.lon, 8000, 'full'))) {
			expect(half).toBeCloseTo(8000, -2);
		}
	});

	it('falls back to something markedly cheaper, not merely different', () => {
		const full = buildQuery(at.lat, at.lon, 60000, 'full');
		const lean = buildQuery(at.lat, at.lon, 60000, 'lean');

		expect(clauses(lean).length).toBeLessThan(clauses(full).length);
		expect(Math.max(...halfWidths(lean))).toBeLessThan(Math.max(...halfWidths(full)));
		const limitOf = (q: string) => Number(q.match(/out tags center (\d+);/)![1]);
		expect(limitOf(lean)).toBeLessThan(limitOf(full));
	});

	it('still offers somewhere to stand and somewhere to sit when reduced', () => {
		const lean = buildQuery(at.lat, at.lon, 30000, 'lean');
		expect(lean).toContain('"tourism"="viewpoint"');
		expect(lean).toContain('"outdoor_seating"="yes"');
		expect(lean).toContain('"amenity"="parking"');
	});

	it('asks only for named summits', () => {
		// Unnamed peaks run to thousands in any mountain range, and a card that
		// cannot name a summit cannot help anyone find it.
		expect(buildQuery(at.lat, at.lon, 30000)).toContain('node["natural"="peak"]["name"]');
	});

	it('holds the radius inside what a shared service can afford', () => {
		expect(clampRadius(50)).toBe(2000);
		expect(clampRadius(500000)).toBe(MAX_RADIUS_M);
		expect(clampRadius(30000.4)).toBe(30000);
	});
});

describe('the bounding box', () => {
	it('contains the circle it stands in for', () => {
		const box = boundingBox(47.66, 23.58, 30000);
		expect((box.north - box.south) / 2).toBeCloseTo(30000 / 111320, 6);
		// A degree of longitude is shorter at 47°N, so the box must be wider in
		// degrees to hold the same distance east and west.
		expect(box.east - box.west).toBeGreaterThan(box.north - box.south);
	});

	it('widens towards the poles without running away', () => {
		const tromso = boundingBox(69.65, 18.96, 30000);
		const quito = boundingBox(-0.18, -78.47, 30000);
		expect(tromso.east - tromso.west).toBeGreaterThan(quito.east - quito.west);
		// At the pole itself the cosine floor stops the box becoming infinite.
		const pole = boundingBox(89.99, 0, 30000);
		expect(Number.isFinite(pole.east - pole.west)).toBe(true);
		expect(pole.north).toBeLessThanOrEqual(90);
	});

	it('clips at the antimeridian rather than wrapping, which Overpass rejects', () => {
		const box = boundingBox(-16.5, 179.9, 40000);
		expect(box.east).toBeLessThanOrEqual(180);
		expect(box.west).toBeGreaterThanOrEqual(-180);
	});
});
