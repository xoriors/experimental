import { describe, it, expect } from 'vitest';
import { decodeView, encodeView } from '../src/lib/url-state';

function roundTrip(qs: string) {
	const decoded = decodeView(new URLSearchParams(qs));
	const re = encodeView(decoded);
	return { decoded, re };
}

describe('url-state', () => {
	it('decodes a route view', () => {
		const { decoded } = roundTrip(
			'tab=route&from=7.7388,98.7784&to=8.0340,98.8250&day=tomorrow&expand=09,15'
		);
		expect(decoded.tab).toBe('route');
		expect(decoded.from).toEqual({ lat: 7.7388, lon: 98.7784, label: undefined });
		expect(decoded.to).toEqual({ lat: 8.034, lon: 98.825, label: undefined });
		expect(decoded.day).toBe('tomorrow');
		expect([...decoded.expanded].sort()).toEqual(['09', '15']);
	});

	it('decodes a fixed view with label', () => {
		const { decoded } = roundTrip(
			'tab=fixed&at=7.7388,98.7784&label_at=' + encodeURIComponent('Phi Phi') + '&day=d2'
		);
		expect(decoded.tab).toBe('fixed');
		expect(decoded.at?.label).toBe('Phi Phi');
		expect(decoded.day).toBe('d2');
	});

	it('defaults sane values for empty query', () => {
		const { decoded } = roundTrip('');
		expect(decoded.tab).toBe('route');
		expect(decoded.day).toBe('today');
		expect(decoded.from).toBeNull();
		expect(decoded.expanded.size).toBe(0);
		expect(decoded.tripMode).toBe('auto');
		expect(decoded.tripDurationH).toBe(2);
	});

	it('decodes tripMode and tripDurationH', () => {
		const { decoded } = roundTrip('tab=route&mode=sea&dur=4');
		expect(decoded.tripMode).toBe('sea');
		expect(decoded.tripDurationH).toBe(4);
	});

	it('decodes tripMinHour and clamps to 0..23', () => {
		expect(roundTrip('minh=8').decoded.tripMinHour).toBe(8);
		expect(roundTrip('minh=99').decoded.tripMinHour).toBe(23);
		expect(roundTrip('minh=-5').decoded.tripMinHour).toBe(0);
		expect(roundTrip('').decoded.tripMinHour).toBe(0);
	});

	it('includes minh when non-default', () => {
		const { re } = roundTrip('tab=route&minh=8');
		expect(new URLSearchParams(re).get('minh')).toBe('8');
	});

	it('omits minh when default 0', () => {
		const { re } = roundTrip('tab=route');
		expect(new URLSearchParams(re).has('minh')).toBe(false);
	});

	it('clamps duration to 1..12', () => {
		expect(roundTrip('dur=99').decoded.tripDurationH).toBe(12);
		expect(roundTrip('dur=0').decoded.tripDurationH).toBe(1);
		expect(roundTrip('dur=garbage').decoded.tripDurationH).toBe(2);
	});

	it('rejects invalid mode and falls back to auto', () => {
		expect(roundTrip('mode=bogus').decoded.tripMode).toBe('auto');
	});

	it('omits mode and dur from URL when default', () => {
		const { re } = roundTrip('tab=route');
		const params = new URLSearchParams(re);
		expect(params.has('mode')).toBe(false);
		expect(params.has('dur')).toBe(false);
	});

	it('includes mode and dur when non-default', () => {
		const { re } = roundTrip('tab=route&mode=land&dur=6');
		const params = new URLSearchParams(re);
		expect(params.get('mode')).toBe('land');
		expect(params.get('dur')).toBe('6');
	});

	it('rejects out-of-range coordinates', () => {
		const { decoded } = roundTrip('tab=fixed&at=200,500');
		expect(decoded.at).toBeNull();
	});

	it('rejects malformed expand slots', () => {
		const { decoded } = roundTrip('tab=fixed&expand=09,abc,15');
		expect([...decoded.expanded].sort()).toEqual(['09', '15']);
	});

	it('round-trip is stable for route', () => {
		const original = 'day=tomorrow&expand=09%2C15&from=7.7388%2C98.7784&tab=route&to=8.0340%2C98.8250';
		const { decoded } = roundTrip(original);
		const reEncoded = encodeView(decoded);
		const params = new URLSearchParams(reEncoded);
		expect(params.get('tab')).toBe('route');
		expect(params.get('from')).toBe('7.7388,98.7784');
		expect(params.get('to')).toBe('8.0340,98.8250');
		expect(params.get('day')).toBe('tomorrow');
		expect(params.get('expand')).toBe('09,15');
	});
});
