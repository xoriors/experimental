import { describe, expect, it } from 'vitest';
import { looksHealthy } from '../src/lib/data/overpass-health';

/** Midday on the day the eclipse crosses Europe. */
const NOW = Date.parse('2026-08-12T12:00:00Z');

describe('deciding whether an Overpass mirror actually answered', () => {
	it('accepts a normal reply and says how far behind the mirror is', () => {
		expect(
			looksHealthy({ elements: [{}], osm3s: { timestamp_osm_base: '2026-08-12T10:44:41Z' } }, NOW)
		).toEqual({ ok: true, ageDays: 0 });
	});

	it('accepts an genuinely empty area', () => {
		// Middle of an ocean: no spots, but a healthy database behind it.
		expect(
			looksHealthy({ elements: [], osm3s: { timestamp_osm_base: '2026-05-06T03:25:00Z' } }, NOW)
		).toEqual({ ok: true, ageDays: 98 });
	});

	it('tolerates a mirror some months behind, because hilltops do not move', () => {
		// kumi.systems was 98 days behind when this was written. Refusing it would
		// throw away a working fallback over data this site does not depend on.
		const verdict = looksHealthy(
			{ elements: [{}], osm3s: { timestamp_osm_base: '2026-05-06T03:25:00Z' } },
			NOW
		);
		expect(verdict.ok).toBe(true);
	});

	it('refuses a copy nobody has updated in years', () => {
		const verdict = looksHealthy(
			{ elements: [{}], osm3s: { timestamp_osm_base: '2022-01-04T00:00:00Z' } },
			NOW
		);
		expect(verdict.ok).toBe(false);
		expect(verdict.ok === false && verdict.reason).toMatch(/years out of date/);
	});

	it('rejects a regional mirror pretending to cover the planet', () => {
		// overpass.osm.ch answers 200 with an empty list for anywhere outside
		// Switzerland, and gives its database age as a bare number.
		const verdict = looksHealthy({ elements: [], osm3s: { timestamp_osm_base: '116339' } });
		expect(verdict.ok).toBe(false);
		expect(verdict.ok === false && verdict.reason).toMatch(/unusable database timestamp/);
	});

	it('rejects an overloaded instance that reports the problem in the body', () => {
		for (const remark of [
			'runtime error: Query timed out in "query" at line 3 after 25 seconds.',
			'runtime error: Query run out of memory in "recurse" at line 5.'
		]) {
			const verdict = looksHealthy({ elements: [], remark });
			expect(verdict.ok, remark).toBe(false);
		}
	});

	it('does not mind a reply with no timestamp at all', () => {
		expect(looksHealthy({ elements: [{}] })).toEqual({ ok: true });
	});

	it('ignores a remark that is not about failure', () => {
		expect(
			looksHealthy(
				{
					elements: [{}],
					remark: 'improvised note',
					osm3s: { timestamp_osm_base: '2026-08-12T10:44:41Z' }
				},
				NOW
			)
		).toEqual({ ok: true, ageDays: 0 });
	});
});
