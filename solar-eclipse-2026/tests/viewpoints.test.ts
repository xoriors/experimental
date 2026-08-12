import { afterEach, describe, expect, it, vi } from 'vitest';
import { findViewpoints } from '../src/lib/eclipse/viewpoints';
import { SAMPLE_DISTANCES_M } from '../src/lib/eclipse/horizon';

/** Three spots around Baia Mare: a hilltop, a valley floor and a summit. */
const OVERPASS = {
	elements: [
		{ type: 'node', id: 1, lat: 47.6748, lon: 23.5913, tags: { tourism: 'viewpoint', name: 'Dealul Crucii' } },
		{ type: 'node', id: 2, lat: 47.66, lon: 23.55, tags: { amenity: 'parking', name: 'Valley car park' } },
		{ type: 'node', id: 3, lat: 47.7315, lon: 23.6729, tags: { natural: 'peak', name: 'Igniș', ele: '1307' } },
		{ type: 'node', id: 4, lat: 47.67, lon: 23.6, tags: { amenity: 'bench' } },
		{ type: 'way', id: 5, center: { lat: 47.64, lon: 23.6 }, tags: { tourism: 'viewpoint', name: 'Ridge lookout' } }
	]
};

/**
 * Ground height and westward skyline for each fixture site, keyed by position.
 * Resolving by coordinate rather than by request order keeps these tests honest
 * when the shortlist decides to return the spots in a different sequence.
 */
const SITES = [
	{ name: 'origin', lat: 47.6573, lon: 23.5681, ground: 220, ridge: 600 },
	{ name: 'Dealul Crucii', lat: 47.6748, lon: 23.5913, ground: 506, ridge: 600 },
	{ name: 'Valley car park', lat: 47.66, lon: 23.55, ground: 210, ridge: 600 },
	{ name: 'Igniș', lat: 47.7315, lon: 23.6729, ground: 1302, ridge: 600 },
	{ name: 'Ridge lookout', lat: 47.64, lon: 23.6, ground: 400, ridge: 600 }
];

function nearestSite(lat: number, lon: number) {
	let best = SITES[0];
	let bestDistance = Infinity;
	for (const site of SITES) {
		const d = Math.hypot((site.lat - lat) * 111, (site.lon - lon) * 75);
		if (d < bestDistance) {
			bestDistance = d;
			best = site;
		}
	}
	return best;
}

/**
 * Stands in for both services. Elevation replies are assembled from whichever
 * site each requested coordinate belongs to: the first of every group of
 * `stride` coordinates is a spot itself, the rest are its skyline samples.
 */
function mockFetch(skyline: (site: (typeof SITES)[number], sampleIndex: number) => number) {
	return vi.fn(async (url: string) => {
		if (String(url).includes('/api/viewing-spots')) {
			return new Response(JSON.stringify(OVERPASS));
		}
		const params = new URL(String(url), 'http://localhost').searchParams;
		const lats = params.get('latitude')!.split(',').map(Number);
		const lons = params.get('longitude')!.split(',').map(Number);
		const stride = 1 + SAMPLE_DISTANCES_M.length;

		let current = SITES[0];
		const elevation = lats.map((lat, i) => {
			if (i % stride === 0) {
				current = nearestSite(lat, lons[i]);
				return current.ground;
			}
			return skyline(current, (i % stride) - 1);
		});
		return new Response(JSON.stringify({ elevation }));
	});
}

afterEach(() => vi.unstubAllGlobals());

describe('finding somewhere to watch from', () => {
	const stride = 1 + SAMPLE_DISTANCES_M.length;
	/** A ridge at 600 m sits west of everything within 5.5 km. */
	const ridgeWest = (site: (typeof SITES)[number], sampleIndex: number) =>
		SAMPLE_DISTANCES_M[sampleIndex] <= 5500 ? site.ridge : 300;

	it('ranks a hilltop above a valley floor and reports the reason', async () => {
		vi.stubGlobal('fetch', mockFetch(ridgeWest));
		const result = await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);

		expect(result.found).toBe(4); // the bench is not a viewing spot
		expect(result.origin!.verdict.quality).toBe('blocked');

		const byName = Object.fromEntries(result.spots.map((s) => [s.spot.name, s]));
		// The summit stands above the ridge; the valley car park does not.
		expect(byName['Igniș'].horizon.angle).toBeLessThan(byName['Valley car park'].horizon.angle);
		expect(result.spots[0].spot.name).toBe('Igniș');
		expect(result.spots.at(-1)!.verdict.quality).toBe('blocked');
	});

	it('labels summits as possibly needing a walk but car parks as drivable', async () => {
		vi.stubGlobal('fetch', mockFetch(() => 200));
		const result = await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);
		const byName = Object.fromEntries(result.spots.map((s) => [s.spot.name, s]));
		expect(byName['Igniș'].spot.drivable).toBe(false);
		expect(byName['Valley car park'].spot.drivable).toBe(true);
		expect(byName['Dealul Crucii'].spot.drivable).toBe(true);
	});

	it('marks which spots you can settle in at for an hour', async () => {
		vi.stubGlobal('fetch', mockFetch(() => 200));
		const result = await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);
		const byName = Object.fromEntries(result.spots.map((s) => [s.spot.name, s]));
		// A viewpoint you can sit at; a car park you cannot really linger in.
		expect(byName['Dealul Crucii'].spot.canLinger).toBe(true);
		expect(byName['Valley car park'].spot.canLinger).toBe(false);
	});

	it('always evaluates the starting point so you know whether to move at all', async () => {
		vi.stubGlobal('fetch', mockFetch(() => 100));
		const result = await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);
		expect(result.origin).not.toBeNull();
		expect(result.origin!.spot.id).toBe('origin');
		expect(result.origin!.distanceM).toBeCloseTo(0, 3);
		// Ground falls away, so the skyline is below level and the view is open.
		expect(result.origin!.horizon.angle).toBeLessThan(0);
	});

	it('reports each spot in the direction the Sun will actually be', async () => {
		vi.stubGlobal('fetch', mockFetch(() => 200));
		const result = await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);
		for (const spot of result.spots) {
			// Over Romania the Sun sets well north of west.
			expect(spot.sunAzimuthDeg).toBeGreaterThan(280);
			expect(spot.sunAzimuthDeg).toBeLessThan(305);
		}
	});

	it('asks the elevation service for exactly one skyline per spot', async () => {
		const fetchMock = mockFetch(() => 200);
		vi.stubGlobal('fetch', fetchMock);
		const result = await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);
		const elevationUrl = fetchMock.mock.calls.find(([u]) => String(u).includes('elevation'))![0];
		const latitudes = new URL(String(elevationUrl), 'http://localhost').searchParams
			.get('latitude')!
			.split(',');
		expect(latitudes).toHaveLength((result.spots.length + 1) * stride);
	});

	it('still judges the starting point when the spot list is unavailable', async () => {
		// Overpass is regularly overloaded. Losing the suggestions is tolerable;
		// losing the answer to "can I see it from here" is not, and it only needs
		// terrain, so the elevation lookup must still run.
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (String(url).includes('/api/viewing-spots')) {
					return new Response(JSON.stringify({ message: 'Overpass replied 504.' }), {
						status: 503
					});
				}
				if (String(url).includes('overpass')) return new Response('busy', { status: 504 });
				return new Response(
					JSON.stringify({ elevation: [220, ...SAMPLE_DISTANCES_M.map(() => 150)] })
				);
			})
		);
		const result = await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);
		// The endpoint's account of the failure is the one worth keeping — the
		// browser's direct attempt can only report that it did not work either.
		expect(result.spotsUnavailable).toMatch(/Overpass replied 504/);
		expect(result.spots).toHaveLength(0);
		expect(result.origin).not.toBeNull();
		expect(result.origin!.horizon.angle).toBeLessThan(0);
	});

	it('never calls Overpass from the browser, even when the endpoint fails', async () => {
		// Tried and withdrawn: OSM France sends `Access-Control-Allow-Origin: *`
		// and answers a preflight, which looks like an invitation, but refuses the
		// request itself with "403 This service is only available to white-listed
		// usages" on the strength of the User-Agent. A browser cannot change that,
		// so a direct attempt only costs a wasted request and a CORS error in the
		// console beside a search that had already succeeded.
		const fetchMock = vi.fn(async (url: string) => {
			if (String(url).includes('/api/viewing-spots')) {
				return new Response(JSON.stringify({ message: 'Overpass is not answering.' }), {
					status: 503
				});
			}
			const params = new URL(String(url), 'http://localhost').searchParams;
			const lats = params.get('latitude')!.split(',').map(Number);
			return new Response(JSON.stringify({ elevation: lats.map(() => 200) }));
		});
		vi.stubGlobal('fetch', fetchMock);

		await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);

		const urls = fetchMock.mock.calls.map(([u]) => String(u));
		expect(urls.some((u) => u.includes('overpass.openstreetmap.fr'))).toBe(false);
		expect(urls.some((u) => /^https?:\/\/[^/]*overpass/.test(u))).toBe(false);
	});

	it('gives up only when the terrain data is unavailable too', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
		await expect(findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000)).rejects.toThrow(
			/elevation/i
		);
	});

	it('keeps spots aligned with their heights when the lookup spans batches', async () => {
		// The elevation service takes a hundred coordinates per call, and each spot
		// costs fifteen, so any search past six spots is split. If the pieces were
		// reassembled even one place out, every spot would be judged against its
		// neighbour's hillside.
		const many = {
			elements: Array.from({ length: 12 }, (_, i) => ({
				type: 'node',
				id: 100 + i,
				lat: 47.6 + i * 0.01,
				lon: 23.5 + i * 0.01,
				tags: { tourism: 'viewpoint', name: `Spot ${i}` }
			}))
		};
		// Height is a function of the coordinate alone, exactly as the real service
		// behaves. That makes the check independent of how the request happens to
		// be chopped into batches — which is the point.
		const heightFor = (lat: number, lon: number) =>
			200 + Math.round((lat - 47) * 10000) + Math.round((lon - 23) * 100);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (String(url).includes('/api/viewing-spots')) {
					return new Response(JSON.stringify(many));
				}
				const params = new URL(String(url), 'http://localhost').searchParams;
				const lats = params.get('latitude')!.split(',').map(Number);
				const lons = params.get('longitude')!.split(',').map(Number);
				return new Response(
					JSON.stringify({ elevation: lats.map((lat, i) => heightFor(lat, lons[i])) })
				);
			})
		);

		const result = await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);
		expect(result.spots.length).toBeGreaterThan(6); // enough to span batches

		for (const scored of result.spots) {
			expect(Math.round(scored.elevationM), scored.spot.name).toBe(
				heightFor(scored.spot.lat, scored.spot.lon)
			);
		}
	});

	it('prefers its own endpoint and does not trouble Overpass twice for one answer', async () => {
		// The endpoint caches at the edge and identifies itself as Overpass's usage
		// policy asks, so while it works nothing else should be asking.
		const fetchMock = mockFetch(() => 200);
		vi.stubGlobal('fetch', fetchMock);
		await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);
		const urls = fetchMock.mock.calls.map(([u]) => String(u));
		expect(urls.some((u) => u.startsWith('/api/viewing-spots?'))).toBe(true);
		expect(urls.some((u) => u.includes('overpass'))).toBe(false);
		// overpass-api.de sends no CORS headers, so it is never called from here.
		expect(urls.some((u) => u.includes('overpass-api.de'))).toBe(false);
	});
});
