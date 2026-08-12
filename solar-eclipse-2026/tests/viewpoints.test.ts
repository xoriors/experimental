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

/** Heights keyed by how the fixture wants each spot to behave. */
const GROUND: Record<string, number> = {
	origin: 220,
	'Dealul Crucii': 506,
	'Valley car park': 210,
	Igniș: 1302,
	'Ridge lookout': 400
};

function mockFetch(elevationFor: (index: number) => number[]) {
	let elevationCall = 0;
	return vi.fn(async (url: string, init?: RequestInit) => {
		if (String(url).includes('overpass')) {
			expect(init?.method).toBe('POST');
			return new Response(JSON.stringify(OVERPASS));
		}
		const values = elevationFor(elevationCall++);
		return new Response(JSON.stringify({ elevation: values }));
	});
}

afterEach(() => vi.unstubAllGlobals());

describe('finding somewhere to watch from', () => {
	const stride = 1 + SAMPLE_DISTANCES_M.length;

	/** Build the elevation reply: each spot's own height, then its skyline. */
	function buildElevations(names: string[], skyline: (name: string) => number[]): number[] {
		const out: number[] = [];
		for (const name of names) {
			out.push(GROUND[name]);
			out.push(...skyline(name));
		}
		return out;
	}

	it('ranks a hilltop above a valley floor and reports the reason', async () => {
		const order = ['origin', 'Dealul Crucii', 'Ridge lookout', 'Valley car park', 'Igniș'];
		// A ridge at 600 m sits west of everything.
		const skyline = () => SAMPLE_DISTANCES_M.map((d) => (d <= 5500 ? 600 : 300));
		vi.stubGlobal('fetch', mockFetch(() => buildElevations(order, skyline)));

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
		const order = ['origin', 'Dealul Crucii', 'Ridge lookout', 'Valley car park', 'Igniș'];
		vi.stubGlobal('fetch', mockFetch(() => buildElevations(order, () => SAMPLE_DISTANCES_M.map(() => 200))));
		const result = await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);
		const byName = Object.fromEntries(result.spots.map((s) => [s.spot.name, s]));
		expect(byName['Igniș'].spot.drivable).toBe(false);
		expect(byName['Valley car park'].spot.drivable).toBe(true);
		expect(byName['Dealul Crucii'].spot.drivable).toBe(true);
	});

	it('always evaluates the starting point so you know whether to move at all', async () => {
		const order = ['origin', 'Dealul Crucii', 'Ridge lookout', 'Valley car park', 'Igniș'];
		vi.stubGlobal('fetch', mockFetch(() => buildElevations(order, () => SAMPLE_DISTANCES_M.map(() => 100))));
		const result = await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);
		expect(result.origin).not.toBeNull();
		expect(result.origin!.spot.id).toBe('origin');
		expect(result.origin!.distanceM).toBeCloseTo(0, 3);
		// Ground falls away, so the skyline is below level and the view is open.
		expect(result.origin!.horizon.angle).toBeLessThan(0);
	});

	it('reports each spot in the direction the Sun will actually be', async () => {
		const order = ['origin', 'Dealul Crucii', 'Ridge lookout', 'Valley car park', 'Igniș'];
		vi.stubGlobal('fetch', mockFetch(() => buildElevations(order, () => SAMPLE_DISTANCES_M.map(() => 200))));
		const result = await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);
		for (const spot of result.spots) {
			// Over Romania the Sun sets well north of west.
			expect(spot.sunAzimuthDeg).toBeGreaterThan(280);
			expect(spot.sunAzimuthDeg).toBeLessThan(305);
		}
	});

	it('asks the elevation service for exactly one skyline per spot', async () => {
		const order = ['origin', 'Dealul Crucii', 'Ridge lookout', 'Valley car park', 'Igniș'];
		const fetchMock = mockFetch(() => buildElevations(order, () => SAMPLE_DISTANCES_M.map(() => 200)));
		vi.stubGlobal('fetch', fetchMock);
		await findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000);
		const elevationUrl = fetchMock.mock.calls.find(([u]) => String(u).includes('elevation'))![0];
		const latitudes = new URL(String(elevationUrl)).searchParams.get('latitude')!.split(',');
		expect(latitudes).toHaveLength(order.length * stride);
	});

	it('surfaces a failure from the map data service rather than returning nothing', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
		await expect(findViewpoints({ lat: 47.6573, lon: 23.5681 }, 30000)).rejects.toThrow(
			/OpenStreetMap/
		);
	});
});
