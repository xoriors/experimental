import { describe, it, expect } from 'vitest';
import { decodeView, encodeView, hhmmToMin, minToHHMM } from '../src/lib/url-state';
import type { ViewState } from '../src/lib/types';

function freshState(): ViewState {
	return {
		tab: 'route',
		from: null,
		to: null,
		at: null,
		day: 'today',
		expanded: new Set<string>(),
		tripMode: 'auto',
		tripDurationH: 2,
		tripMinMin: 0,
		tripMaxMin: 1380,
		intervals: {
			today: { min: null, max: null, durationH: null, mode: null },
			tomorrow: { min: null, max: null, durationH: null, mode: null },
			d2: { min: null, max: null, durationH: null, mode: null }
		},
		highlight: null
	};
}

function roundTrip(v: ViewState): ViewState {
	const encoded = encodeView(v);
	const params = new URLSearchParams(encoded);
	return decodeView(params);
}

describe('url-state key=value round-trip', () => {
	it('defaults round-trip to an empty string', () => {
		const v = freshState();
		expect(encodeView(v)).toBe('');
		const r = roundTrip(v);
		expect(r.tab).toBe('route');
		expect(r.day).toBe('today');
		expect(r.tripMode).toBe('auto');
		expect(r.tripDurationH).toBe(2);
		expect(r.tripMinMin).toBe(0);
		expect(r.tripMaxMin).toBe(1380);
	});

	it('preserves from/to with labels', () => {
		const v = freshState();
		v.from = { lat: 7.7388, lon: 98.7784, label: 'Phi Phi' };
		v.to = { lat: 8.034, lon: 98.825, label: 'Ao Nang' };
		const r = roundTrip(v);
		expect(r.from?.lat).toBe(7.7388);
		expect(r.from?.lon).toBe(98.7784);
		expect(r.from?.label).toBe('Phi Phi');
		expect(r.to?.label).toBe('Ao Nang');
	});

	it('preserves expanded set', () => {
		const v = freshState();
		v.expanded = new Set(['09', '15']);
		const r = roundTrip(v);
		expect([...r.expanded].sort()).toEqual(['09', '15']);
	});

	it('preserves minutes start/end with 30-min granularity', () => {
		const v = freshState();
		v.tripMinMin = 510;
		v.tripMaxMin = 1050;
		const r = roundTrip(v);
		expect(r.tripMinMin).toBe(510);
		expect(r.tripMaxMin).toBe(1050);
	});

	it('preserves per-day overrides', () => {
		const v = freshState();
		v.intervals.today = { min: 540, max: 1020, durationH: 4, mode: 'sea' };
		v.intervals.tomorrow = { min: null, max: null, durationH: 6, mode: null };
		const r = roundTrip(v);
		expect(r.intervals.today).toEqual({ min: 540, max: 1020, durationH: 4, mode: 'sea' });
		expect(r.intervals.tomorrow).toEqual({ min: null, max: null, durationH: 6, mode: null });
	});

	it('encodes as readable key=value pairs without base64', () => {
		const v = freshState();
		v.tab = 'fixed';
		v.tripDurationH = 4;
		v.at = { lat: 7.7388, lon: 98.7784, label: 'Phi Phi' };
		const encoded = encodeView(v);
		expect(encoded).not.toContain('s=');
		const params = new URLSearchParams(encoded);
		expect(params.get('t')).toBe('fixed');
		expect(params.get('dh')).toBe('4');
		expect(params.get('a')).toBe('7.7388,98.7784');
		expect(params.get('al')).toBe('Phi Phi');
	});

	it('omits keys whose values match the defaults', () => {
		const v = freshState();
		v.day = 'tomorrow';
		const encoded = encodeView(v);
		const params = new URLSearchParams(encoded);
		expect(params.has('t')).toBe(false);
		expect(params.has('md')).toBe(false);
		expect(params.get('d')).toBe('tomorrow');
	});

	it('preserves highlight', () => {
		const v = freshState();
		v.highlight = '2026-05-21T09:00';
		const r = roundTrip(v);
		expect(r.highlight).toBe('2026-05-21T09:00');
	});

	it('rejects invalid highlight format', () => {
		const v = freshState();
		v.highlight = 'garbage' as unknown as string;
		const r = roundTrip(v);
		expect(r.highlight).toBeNull();
	});
});

describe('url-state legacy fallback', () => {
	it('decodes old-style ?tab=route&from=lat,lon links', () => {
		const params = new URLSearchParams('tab=route&from=7.7388,98.7784&to=8.034,98.825&day=tomorrow');
		const decoded = decodeView(params);
		expect(decoded.tab).toBe('route');
		expect(decoded.from?.lat).toBe(7.7388);
		expect(decoded.to?.lon).toBe(98.825);
		expect(decoded.day).toBe('tomorrow');
	});

	it('decodes legacy fixed view with label', () => {
		const params = new URLSearchParams(
			'tab=fixed&at=7.7388,98.7784&label_at=' + encodeURIComponent('Phi Phi')
		);
		const decoded = decodeView(params);
		expect(decoded.tab).toBe('fixed');
		expect(decoded.at?.label).toBe('Phi Phi');
	});

	it('decodes legacy base64 ?s= blob', () => {
		const obj = { t: 'fixed', a: [7.7388, 98.7784, 'Phi Phi'], d: 'tomorrow' };
		const b64 = btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
		const params = new URLSearchParams('s=' + b64);
		const decoded = decodeView(params);
		expect(decoded.tab).toBe('fixed');
		expect(decoded.at?.label).toBe('Phi Phi');
		expect(decoded.day).toBe('tomorrow');
	});

	it('falls back gracefully on malformed s= param', () => {
		const params = new URLSearchParams('s=not-base64!!!');
		const decoded = decodeView(params);
		expect(decoded.tab).toBe('route');
		expect(decoded.from).toBeNull();
	});
});

describe('hhmm helpers', () => {
	it('hhmmToMin parses HH:MM in 30-min steps', () => {
		expect(hhmmToMin('00:00')).toBe(0);
		expect(hhmmToMin('08:30')).toBe(510);
		expect(hhmmToMin('17:30')).toBe(1050);
		expect(hhmmToMin('23:30')).toBe(1410);
	});

	it('hhmmToMin rejects non-half-hour minutes', () => {
		expect(hhmmToMin('08:15')).toBeNull();
		expect(hhmmToMin('08:45')).toBeNull();
	});

	it('minToHHMM formats correctly', () => {
		expect(minToHHMM(0)).toBe('00:00');
		expect(minToHHMM(510)).toBe('08:30');
		expect(minToHHMM(1050)).toBe('17:30');
	});
});
