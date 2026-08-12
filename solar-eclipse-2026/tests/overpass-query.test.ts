import { describe, expect, it } from 'vitest';
import { buildQuery, clampRadius, MAX_RADIUS_M } from '../src/lib/data/overpass-query';

/** Every `(around:<radius>,<lat>,<lon>)` in a query, in metres. */
function radii(query: string): number[] {
	return [...query.matchAll(/\(around:(\d+),/g)].map((m) => Number(m[1]));
}

function clauses(query: string): string[] {
	return query
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.endsWith(');') && line.includes('around:'));
}

describe('the Overpass query', () => {
	const at = { lat: 47.66, lon: 23.58 };

	it('asks for the output in the order every instance parses', () => {
		// `out center tags 250` puts geometry before verbosity, which some parsers
		// reject outright. Verbosity, then geometry, then the limit.
		expect(buildQuery(at.lat, at.lon, 30000)).toMatch(/\nout tags center \d+;$/);
	});

	it('gives Overpass a runtime limit it can meet, not one it will hit', () => {
		const full = buildQuery(at.lat, at.lon, 30000, 'full');
		const lean = buildQuery(at.lat, at.lon, 30000, 'lean');
		const timeoutOf = (q: string) => Number(q.match(/\[timeout:(\d+)\]/)![1]);
		// Both must finish inside the endpoint's own eight-second attempt window
		// with room to spare, and the fallback must be the quicker of the two.
		expect(timeoutOf(full)).toBeLessThanOrEqual(10);
		expect(timeoutOf(lean)).toBeLessThan(timeoutOf(full));
	});

	it('keeps the everyday things close and only ranges wide for the rare ones', () => {
		// A 60 km circle holds thousands of car parks and no more viewpoints worth
		// having. Asking for all of them is what earns a gateway 504.
		const query = buildQuery(at.lat, at.lon, 60000, 'full');
		const viewpoint = query.match(/nwr\["tourism"="viewpoint"\]\(around:(\d+),/)![1];
		const parking = query.match(/nwr\["amenity"="parking"\]\["name"\]\(around:(\d+),/)![1];
		const terrace = query.match(/"outdoor_seating"="yes".*\(around:(\d+),/)![1];

		expect(Number(viewpoint)).toBe(60000);
		expect(Number(parking)).toBeLessThanOrEqual(20000);
		expect(Number(terrace)).toBeLessThanOrEqual(25000);
	});

	it('never widens a search the user asked to keep small', () => {
		for (const radius of radii(buildQuery(at.lat, at.lon, 8000, 'full'))) {
			expect(radius).toBe(8000);
		}
	});

	it('falls back to something markedly cheaper, not merely different', () => {
		const full = buildQuery(at.lat, at.lon, 60000, 'full');
		const lean = buildQuery(at.lat, at.lon, 60000, 'lean');

		expect(clauses(lean).length).toBeLessThan(clauses(full).length);
		expect(Math.max(...radii(lean))).toBeLessThan(Math.max(...radii(full)));
		const limitOf = (q: string) => Number(q.match(/out tags center (\d+);/)![1]);
		expect(limitOf(lean)).toBeLessThan(limitOf(full));
	});

	it('still offers somewhere to stand and somewhere to sit when reduced', () => {
		const lean = buildQuery(at.lat, at.lon, 30000, 'lean');
		expect(lean).toContain('"tourism"="viewpoint"');
		expect(lean).toContain('"outdoor_seating"="yes"');
		expect(lean).toContain('"amenity"="parking"');
	});

	it('leads each venue clause with the tag Overpass can index', () => {
		// The planner uses the first filter it can look up. `outdoor_seating=yes`
		// is a few hundred thousand objects worldwide; `amenity~restaurant|cafe…`
		// is tens of millions, and starting there scans most of a country.
		expect(buildQuery(at.lat, at.lon, 30000)).toContain(
			'nwr["outdoor_seating"="yes"]["amenity"'
		);
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
