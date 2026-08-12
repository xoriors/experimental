import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeocodeError, roughDistanceKm, searchPlaces } from '../src/lib/data/geocode';
import { summariseVisibility } from '../src/lib/eclipse/summary';

const RAW = {
	results: [
		{
			id: 685826,
			name: 'Baia Mare',
			latitude: 47.65729,
			longitude: 23.56808,
			elevation: 220,
			country: 'Romania',
			admin1: 'Maramureş',
			admin2: 'Municipiul Baia Mare',
			population: 108759,
			feature_code: 'PPLA'
		},
		{
			id: 6299700,
			name: 'Baia Mare International Airport',
			latitude: 47.65839,
			longitude: 23.47002,
			elevation: 184,
			country: 'Romania',
			admin1: 'Maramureş',
			feature_code: 'AIRP'
		}
	]
};

afterEach(() => vi.unstubAllGlobals());

describe('place search', () => {
	it('keeps settlements and drops airports and landmarks', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(RAW))));
		const results = await searchPlaces('Baia Mare');
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Baia Mare');
		expect(results[0].country).toBe('Romania');
		expect(results[0].admin).toBe('Maramureş');
		expect(results[0].elevation).toBe(220);
	});

	it('does not call the service for one-character queries', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		expect(await searchPlaces('B')).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reports a helpful error when the service is unreachable', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
		await expect(searchPlaces('Paris')).rejects.toBeInstanceOf(GeocodeError);
	});

	it('reports an error on a bad status', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
		await expect(searchPlaces('Paris')).rejects.toBeInstanceOf(GeocodeError);
	});

	it('copes with a response carrying no results', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}))));
		expect(await searchPlaces('Zzzzz')).toEqual([]);
	});

	it('lets a caller abort propagate so stale keystrokes can be cancelled', async () => {
		vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
			// Mimic fetch: reject with AbortError once the signal trips.
			throw Object.assign(new DOMException('aborted', 'AbortError'), { init });
		}));
		const controller = new AbortController();
		controller.abort();
		await expect(searchPlaces('Paris', controller.signal)).rejects.toBeInstanceOf(DOMException);
	});

	it('surfaces a hung connection as an error rather than spinning forever', async () => {
		// A network that never answers must not leave the box saying "searching".
		vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () =>
					reject(new DOMException('timed out', 'AbortError'))
				);
			})
		));
		vi.useFakeTimers();
		const pending = searchPlaces('Paris');
		const assertion = expect(pending).rejects.toBeInstanceOf(GeocodeError);
		await vi.advanceTimersByTimeAsync(9000);
		await assertion;
		vi.useRealTimers();
	});

	it('measures separation well enough to spot duplicates', () => {
		expect(roughDistanceKm({ lat: 47.657, lon: 23.568 }, { lat: 47.657, lon: 23.568 })).toBeCloseTo(0, 5);
		// Bucharest to Baia Mare is a few hundred km.
		const d = roughDistanceKm({ lat: 44.4268, lon: 26.1025 }, { lat: 47.6573, lon: 23.5681 });
		expect(d).toBeGreaterThan(300);
		expect(d).toBeLessThan(450);
	});
});

describe('the verdict shown against each search result', () => {
	it('separates Romanian cities that are worth the trip from those that are not', () => {
		// The whole point of worldwide search: these are in the same country.
		expect(summariseVisibility(44.4268, 26.1025, 70)).toEqual({ kind: 'none', label: 'Not visible' });
		expect(summariseVisibility(44.1598, 28.6348, 25).kind).toBe('none'); // Constanta
		const baiaMare = summariseVisibility(47.6573, 23.5681, 220);
		expect(baiaMare.kind).toBe('sunset');
		expect(baiaMare.label).toMatch(/^3\d% at sunset$/);
	});

	it('calls out totality with its duration', () => {
		const palencia = summariseVisibility(42.0096, -4.5288, 740);
		expect(palencia.kind).toBe('total');
		expect(palencia.label).toMatch(/^Totality 1m 4\ds$/);
	});

	it('describes a high-Sun partial without the sunset caveat', () => {
		const london = summariseVisibility(51.5072, -0.1276, 11);
		expect(london.kind).toBe('partial');
		expect(london.label).toBe('91% covered');
	});

	it('says nothing is visible where the eclipse never reaches', () => {
		expect(summariseVisibility(-33.9249, 18.4241).kind).toBe('none'); // Cape Town
	});
});
