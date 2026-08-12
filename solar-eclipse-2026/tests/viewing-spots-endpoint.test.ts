import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../src/routes/api/viewing-spots/+server';

/**
 * The endpoint as the browser calls it. Only `url` and `fetch` are read.
 */
async function call(fetchMock: typeof fetch, params = 'lat=47.66&lon=23.58&radius=30000') {
	return GET({
		url: new URL(`https://example.test/api/viewing-spots?${params}`),
		fetch: fetchMock
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any) as Promise<Response>;
}

/**
 * The timestamp is generated rather than written down: the endpoint refuses a
 * mirror whose database is years old, so a fixed date here would quietly turn
 * into a failing test one day for no reason anybody would enjoy tracking down.
 */
const GOOD = {
	elements: [{ type: 'node', id: 1, lat: 47.6, lon: 23.5, tags: { tourism: 'viewpoint' } }],
	osm3s: { timestamp_osm_base: new Date(Date.now() - 3600_000).toISOString() }
};

const FIRST = 'overpass.openstreetmap.fr';

/** The Overpass QL a recorded upstream call carried. */
function queryOf(recorded: [string, RequestInit]): string {
	return String((recorded[1].body as URLSearchParams).get('data'));
}

/** Biergartens are asked for by the full query only. */
function tierOf(recorded: [string, RequestInit]): 'full' | 'lean' {
	return queryOf(recorded).includes('biergarten') ? 'full' : 'lean';
}

function hosts(mock: ReturnType<typeof vi.fn>): string[] {
	return mock.mock.calls.map(([url]) => new URL(String(url)).host);
}

afterEach(() => vi.useRealTimers());

describe('the viewing-spots endpoint', () => {
	it('moves to the next mirror when one is too busy, and says which answered', async () => {
		const upstream = vi.fn(async (url: string) =>
			new URL(url).host === FIRST
				? new Response('rate limited', { status: 429 })
				: new Response(JSON.stringify(GOOD))
		);

		const response = await call(upstream as unknown as typeof fetch);

		expect(response.status).toBe(200);
		expect(response.headers.get('x-upstream')).toBe('overpass-api.de');
		expect(response.headers.get('x-overpass-tier')).toBe('full');
		expect(await response.json()).toEqual(GOOD);
	});

	it('asks the same mirror for less before asking another for the same', async () => {
		// Sixty kilometres around a capital costs 14 seconds as the full query and
		// three as the cheap one. No mirror does better at the first and all of
		// them manage the second, so trying every instance in turn with the query
		// that cannot be answered just spends the budget.
		const upstream = vi.fn(async (_url: string, init: RequestInit) => {
			const query = String((init.body as URLSearchParams).get('data'));
			return query.includes('biergarten')
				? new Response('gateway timeout', { status: 504 })
				: new Response(JSON.stringify(GOOD));
		});

		const response = await call(upstream as unknown as typeof fetch);

		expect(response.status).toBe(200);
		const tiers = upstream.mock.calls.map((c) => tierOf(c as [string, RequestInit]));
		expect(tiers).toEqual(['full', 'lean']);
		expect(hosts(upstream)).toEqual([FIRST, FIRST]);
		// And the page is told, so it can admit the list is not the whole picture.
		expect(response.headers.get('x-overpass-tier')).toBe('lean');
		// A short list must not sit at the edge for a day: one busy minute would
		// otherwise leave everyone searching that town with it until tomorrow.
		expect(response.headers.get('cache-control')).not.toContain('86400');
		expect(response.headers.get('cache-control')).toContain('s-maxage=300');
	});

	it('names what each mirror actually said instead of shrugging', async () => {
		// The old failure message named nothing at all, which made a rate limit
		// indistinguishable from being offline.
		const upstream = vi.fn(async (url: string) =>
			new URL(url).host === FIRST
				? new Response('busy', { status: 504 })
				: new Response('nope', { status: 429 })
		);

		const failure = await call(upstream as unknown as typeof fetch).catch((e) => e);
		expect(failure.status).toBe(503);
		expect(failure.body.message).toContain('overpass.openstreetmap.fr replied 504');
		expect(failure.body.message).toContain('overpass-api.de replied 429');
	});

	it('does not accept a regional mirror answering for the whole planet', async () => {
		// overpass.osm.ch and friends return 200 and an empty list for anywhere
		// outside their country, which would read as "nothing here".
		const upstream = vi.fn(async (url: string) =>
			new URL(url).host === FIRST
				? new Response(JSON.stringify({ elements: [], osm3s: { timestamp_osm_base: '116339' } }))
				: new Response(JSON.stringify(GOOD))
		);

		const response = await call(upstream as unknown as typeof fetch);
		expect(response.headers.get('x-upstream')).toBe('overpass-api.de');
	});

	it('gives up inside its own budget rather than outliving the page waiting for it', async () => {
		vi.useFakeTimers();
		// Mirrors that accept the connection and then say nothing — the shape of a
		// queue, and the reason the browser used to time out first and lose the
		// server's explanation.
		const upstream = vi.fn(
			(_url: string, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError'))
					);
				})
		);

		const pending = call(upstream as unknown as typeof fetch).catch((e) => e);
		await vi.advanceTimersByTimeAsync(60000);
		const failure = await pending;

		expect(failure.status).toBe(503);
		expect(failure.body.message).toMatch(/ran out of time/);
		// 8 s for the full query, 6 s for the cheap one, 8 s for the next mirror:
		// 22 of a 24-second budget. A fourth attempt would push the whole request
		// past what the browser is prepared to wait for.
		expect(hosts(upstream)).toEqual([FIRST, FIRST, 'overpass-api.de']);
	});

	it('does not ask a mirror for less when it could not be reached at all', async () => {
		// Running out of time says something about the question; failing to
		// connect says something about the mirror, and a smaller query will not
		// mend it. The slot is worth more to somebody who might answer.
		const upstream = vi.fn(async () => {
			throw new TypeError('network error');
		});

		const failure = await call(upstream as unknown as typeof fetch).catch((e) => e);

		expect(failure.status).toBe(503);
		expect(failure.body.message).toMatch(/was unreachable/);
		expect(hosts(upstream)).toEqual([
			'overpass.openstreetmap.fr',
			'overpass-api.de',
			'overpass.kumi.systems'
		]);
	});

	it('rounds the position so a town shares one upstream request', async () => {
		const upstream = vi.fn(async (_url: string, _init: RequestInit) =>
			new Response(JSON.stringify(GOOD))
		);
		const response = await call(
			upstream as unknown as typeof fetch,
			'lat=47.66312&lon=23.58197&radius=30000'
		);

		const sent = queryOf(upstream.mock.calls[0] as [string, RequestInit]);
		const [, south, west, north, east] = sent.match(
			/\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\);/
		)!;
		// The boxes are centred on the rounded position, not the caller's exact
		// one, so everyone searching from the same town shares a cache entry.
		expect((Number(south) + Number(north)) / 2).toBeCloseTo(47.66, 4);
		expect((Number(west) + Number(east)) / 2).toBeCloseTo(23.58, 4);
		expect(sent).not.toContain('47.66312');
		expect(response.headers.get('cache-control')).toContain('s-maxage=86400');
	});

	it('refuses nonsense before troubling Overpass with it', async () => {
		const upstream = vi.fn(async (_url: string, _init: RequestInit) =>
			new Response(JSON.stringify(GOOD))
		);
		for (const params of ['lat=91&lon=0&radius=30000', 'lat=0&lon=999&radius=30000', 'lat=0&lon=0']) {
			const failure = await call(upstream as unknown as typeof fetch, params).catch((e) => e);
			expect(failure.status, params).toBe(400);
		}
		expect(upstream).not.toHaveBeenCalled();
	});
});
