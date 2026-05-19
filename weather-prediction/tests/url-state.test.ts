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
