import { describe, expect, it } from 'vitest';
import { penumbraOutline, tToUtc } from '../src/lib/eclipse/besselian';

function bracket(test: (t: number) => boolean) {
	let first = NaN, last = NaN;
	for (let t = -6; t <= 6; t += 1 / 240) {
		if (test(t)) { if (Number.isNaN(first)) first = t; last = t; }
	}
	const refine = (inside: number, outside: number) => {
		let a = inside, b = outside;
		for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (test(m)) a = m; else b = m; }
		return a;
	};
	return { start: refine(first, first - 1 / 240), end: refine(last, last + 1 / 240) };
}

describe('penumbral contacts', () => {
	it('brackets the whole event', () => {
		const r = bracket((t) => penumbraOutline(t, 64) !== null);
		const p1 = tToUtc(r.start), p4 = tToUtc(r.end);
		const minutes = (r.end - r.start) * 60;
		console.log('P1', p1.toISOString(), 'P4', p4.toISOString(), 'span', minutes.toFixed(0), 'min');
		// Published: the eclipse lasts 264 minutes from first to last contact.
		expect(minutes).toBeGreaterThan(258);
		expect(minutes).toBeLessThan(270);
	});
});
