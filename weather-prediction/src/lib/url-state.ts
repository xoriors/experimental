import type { DayKey, DayOverride, LabeledPoint, Tab, TripMode, ViewState } from './types';

function defaultState(): ViewState {
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

function urlSafeB64Encode(s: string): string {
	const utf8 = typeof TextEncoder !== 'undefined'
		? new TextEncoder().encode(s)
		: Buffer.from(s, 'utf-8');
	let bin = '';
	for (const byte of utf8) bin += String.fromCharCode(byte);
	return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function urlSafeB64Decode(s: string): string {
	const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return typeof TextDecoder !== 'undefined'
		? new TextDecoder().decode(bytes)
		: Buffer.from(bytes).toString('utf-8');
}

function pointToTuple(p: LabeledPoint): [number, number, string | undefined] {
	return [Number(p.lat.toFixed(4)), Number(p.lon.toFixed(4)), p.label];
}

function tupleToPoint(t: unknown): LabeledPoint | null {
	if (!Array.isArray(t) || t.length < 2) return null;
	const lat = Number(t[0]);
	const lon = Number(t[1]);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
	const label = typeof t[2] === 'string' ? t[2] : undefined;
	return { lat, lon, label };
}

function isTab(x: unknown): x is Tab {
	return x === 'route' || x === 'fixed';
}
function isDay(x: unknown): x is DayKey {
	return x === 'today' || x === 'tomorrow' || x === 'd2';
}
function isMode(x: unknown): x is TripMode {
	return x === 'auto' || x === 'sea' || x === 'land';
}

function clampMin(n: unknown, lo: number, hi: number, fallback: number): number {
	const v = Number(n);
	if (!Number.isFinite(v)) return fallback;
	return Math.max(lo, Math.min(hi, Math.round(v)));
}

function decodeOverride(o: unknown): DayOverride {
	if (!o || typeof o !== 'object') return { min: null, max: null, durationH: null, mode: null };
	const r = o as Record<string, unknown>;
	return {
		min: r.min === null || r.min === undefined ? null : clampMin(r.min, 0, 1410, 0),
		max: r.max === null || r.max === undefined ? null : clampMin(r.max, 0, 1410, 1380),
		durationH: r.durationH === null || r.durationH === undefined ? null : clampMin(r.durationH, 1, 12, 2),
		mode: isMode(r.mode) ? r.mode : null
	};
}

export function encodeView(v: ViewState): string {
	const obj = {
		t: v.tab,
		f: v.from ? pointToTuple(v.from) : null,
		o: v.to ? pointToTuple(v.to) : null,
		a: v.at ? pointToTuple(v.at) : null,
		d: v.day,
		e: [...v.expanded].sort(),
		md: v.tripMode,
		dh: v.tripDurationH,
		mn: v.tripMinMin,
		mx: v.tripMaxMin,
		iv: v.intervals,
		hl: v.highlight
	};
	const json = JSON.stringify(obj);
	return 's=' + urlSafeB64Encode(json);
}

function decodeBlob(b64: string): ViewState | null {
	try {
		const json = urlSafeB64Decode(b64);
		const obj = JSON.parse(json) as Record<string, unknown>;
		const base = defaultState();
		const expandedRaw = Array.isArray(obj.e) ? obj.e : [];
		const expanded = new Set<string>(
			expandedRaw.filter((s): s is string => typeof s === 'string' && /^\d{2}$/.test(s))
		);
		const hl = obj.hl;
		const intervalsRaw = obj.iv as Record<string, unknown> | undefined;
		return {
			tab: isTab(obj.t) ? obj.t : base.tab,
			from: tupleToPoint(obj.f),
			to: tupleToPoint(obj.o),
			at: tupleToPoint(obj.a),
			day: isDay(obj.d) ? obj.d : base.day,
			expanded,
			tripMode: isMode(obj.md) ? obj.md : base.tripMode,
			tripDurationH: clampMin(obj.dh, 1, 12, base.tripDurationH),
			tripMinMin: clampMin(obj.mn, 0, 1410, base.tripMinMin),
			tripMaxMin: clampMin(obj.mx, 0, 1410, base.tripMaxMin),
			intervals: {
				today: decodeOverride(intervalsRaw?.today),
				tomorrow: decodeOverride(intervalsRaw?.tomorrow),
				d2: decodeOverride(intervalsRaw?.d2)
			},
			highlight:
				typeof hl === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(hl) ? hl : null
		};
	} catch {
		return null;
	}
}

function decodeLegacy(search: URLSearchParams): ViewState {
	const base = defaultState();
	const tab = search.get('tab');
	if (isTab(tab)) base.tab = tab;
	const day = search.get('day');
	if (isDay(day)) base.day = day;
	const fromRaw = search.get('from');
	if (fromRaw) {
		const parts = fromRaw.split(',');
		const lat = Number(parts[0]);
		const lon = Number(parts[1]);
		if (Number.isFinite(lat) && Number.isFinite(lon)) {
			const labelRaw = search.get('label_from');
			base.from = { lat, lon, label: labelRaw ? decodeURIComponent(labelRaw) : undefined };
		}
	}
	const toRaw = search.get('to');
	if (toRaw) {
		const parts = toRaw.split(',');
		const lat = Number(parts[0]);
		const lon = Number(parts[1]);
		if (Number.isFinite(lat) && Number.isFinite(lon)) {
			const labelRaw = search.get('label_to');
			base.to = { lat, lon, label: labelRaw ? decodeURIComponent(labelRaw) : undefined };
		}
	}
	const atRaw = search.get('at');
	if (atRaw) {
		const parts = atRaw.split(',');
		const lat = Number(parts[0]);
		const lon = Number(parts[1]);
		if (Number.isFinite(lat) && Number.isFinite(lon)) {
			const labelRaw = search.get('label_at');
			base.at = { lat, lon, label: labelRaw ? decodeURIComponent(labelRaw) : undefined };
		}
	}
	return base;
}

export function decodeView(search: URLSearchParams): ViewState {
	const blob = search.get('s');
	if (blob) {
		const decoded = decodeBlob(blob);
		if (decoded) return decoded;
	}
	return decodeLegacy(search);
}

export function viewsEqual(a: ViewState, b: ViewState): boolean {
	return encodeView(a) === encodeView(b);
}

export function hhmmToMin(hhmm: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
	if (!m) return null;
	const h = Number(m[1]);
	const mm = Number(m[2]);
	if (h < 0 || h > 23 || (mm !== 0 && mm !== 30)) return null;
	return h * 60 + mm;
}

export function minToHHMM(min: number): string {
	const h = Math.floor(min / 60);
	const mm = min % 60;
	return `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}
