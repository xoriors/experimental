import type { DayKey, DayOverride, LabeledPoint, Tab, TripMode, ViewState } from './types';

const DEFAULTS = {
	tab: 'route' as Tab,
	day: 'today' as DayKey,
	tripMode: 'land' as TripMode,
	tripDurationH: 2,
	tripMinMin: 0,
	tripMaxMin: 1380
};

export function defaultState(): ViewState {
	return {
		tab: DEFAULTS.tab,
		from: null,
		to: null,
		at: null,
		waypoints: [],
		day: DEFAULTS.day,
		expanded: new Set<string>(),
		tripMode: DEFAULTS.tripMode,
		tripDurationH: DEFAULTS.tripDurationH,
		tripMinMin: DEFAULTS.tripMinMin,
		tripMaxMin: DEFAULTS.tripMaxMin,
		intervals: {
			today: { min: null, max: null, durationH: null, mode: null },
			tomorrow: { min: null, max: null, durationH: null, mode: null },
			d2: { min: null, max: null, durationH: null, mode: null }
		},
		highlight: null
	};
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

function isTab(x: unknown): x is Tab {
	return x === 'route' || x === 'fixed' || x === 'waypoints';
}
function isDay(x: unknown): x is DayKey {
	return x === 'today' || x === 'tomorrow' || x === 'd2';
}
function isMode(x: unknown): x is TripMode {
	return x === 'sea' || x === 'land';
}
function coerceMode(x: unknown, fallback: TripMode): TripMode {
	// Treat the legacy 'auto' value from shared URLs as 'sea' (its previous
	// most common resolved value in this app).
	if (x === 'sea' || x === 'land') return x;
	if (x === 'auto') return 'sea';
	return fallback;
}

function clampMin(n: unknown, lo: number, hi: number, fallback: number): number {
	const v = Number(n);
	if (!Number.isFinite(v)) return fallback;
	return Math.max(lo, Math.min(hi, Math.round(v)));
}

function clampHalfHour(n: unknown, fallback: number): number {
	const v = Number(n);
	if (!Number.isFinite(v)) return fallback;
	return Math.max(0, Math.min(1410, Math.round(v / 30) * 30));
}

function pointCoord(p: LabeledPoint): string {
	return `${Number(p.lat.toFixed(4))},${Number(p.lon.toFixed(4))}`;
}

function parsePoint(coord: string | null, label: string | null): LabeledPoint | null {
	if (!coord) return null;
	const parts = coord.split(',');
	const lat = Number(parts[0]);
	const lon = Number(parts[1]);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
	return { lat, lon, label: label || undefined };
}

function encodeOverride(o: DayOverride): string | null {
	if (o.min === null && o.max === null && o.durationH === null && o.mode === null) return null;
	const min = o.min === null ? '' : String(o.min);
	const max = o.max === null ? '' : String(o.max);
	const dur = o.durationH === null ? '' : String(o.durationH);
	const mode = o.mode === null ? '' : o.mode;
	return `${min},${max},${dur},${mode}`;
}

function parseOverride(s: string): DayOverride {
	const parts = s.split(',');
	return {
		min: parts[0] ? clampHalfHour(parts[0], 0) : null,
		max: parts[1] ? clampHalfHour(parts[1], 1380) : null,
		durationH: parts[2] ? clampMin(parts[2], 1, 12, 2) : null,
		mode: isMode(parts[3]) ? parts[3] : null
	};
}

export function encodeView(v: ViewState): string {
	const p = new URLSearchParams();
	if (v.tab !== DEFAULTS.tab) p.set('t', v.tab);
	if (v.from) {
		p.set('f', pointCoord(v.from));
		if (v.from.label) p.set('fl', v.from.label);
	}
	if (v.to) {
		p.set('o', pointCoord(v.to));
		if (v.to.label) p.set('ol', v.to.label);
	}
	if (v.at) {
		p.set('a', pointCoord(v.at));
		if (v.at.label) p.set('al', v.at.label);
	}
	if (v.waypoints.length > 0) {
		p.set('wp', v.waypoints.map(pointCoord).join('|'));
		const labels = v.waypoints.map((w) => w.label ?? '').join('|');
		if (labels.split('|').some((s) => s.length > 0)) p.set('wpl', labels);
	}
	if (v.day !== DEFAULTS.day) p.set('d', v.day);
	if (v.expanded.size > 0) p.set('e', [...v.expanded].sort().join(','));
	if (v.tripMode !== DEFAULTS.tripMode) p.set('md', v.tripMode);
	if (v.tripDurationH !== DEFAULTS.tripDurationH) p.set('dh', String(v.tripDurationH));
	if (v.tripMinMin !== DEFAULTS.tripMinMin) p.set('mn', String(v.tripMinMin));
	if (v.tripMaxMin !== DEFAULTS.tripMaxMin) p.set('mx', String(v.tripMaxMin));
	for (const key of ['today', 'tomorrow', 'd2'] as DayKey[]) {
		const enc = encodeOverride(v.intervals[key]);
		if (enc !== null) p.set('iv_' + key, enc);
	}
	if (v.highlight) p.set('hl', v.highlight);
	return p.toString();
}

function decodeShortKeys(p: URLSearchParams): ViewState {
	const base = defaultState();
	const t = p.get('t');
	if (isTab(t)) base.tab = t;
	const d = p.get('d');
	if (isDay(d)) base.day = d;
	base.from = parsePoint(p.get('f'), p.get('fl'));
	base.to = parsePoint(p.get('o'), p.get('ol'));
	base.at = parsePoint(p.get('a'), p.get('al'));
	const wp = p.get('wp');
	if (wp) {
		const labels = (p.get('wpl') ?? '').split('|');
		base.waypoints = wp
			.split('|')
			.map((coord, i) => parsePoint(coord, labels[i] ?? null))
			.filter((x): x is LabeledPoint => x !== null);
	}
	const e = p.get('e');
	if (e) {
		base.expanded = new Set(e.split(',').filter((s) => /^\d{2}$/.test(s)));
	}
	const md = p.get('md');
	if (md !== null) base.tripMode = coerceMode(md, base.tripMode);
	if (p.has('dh')) base.tripDurationH = clampMin(p.get('dh'), 1, 12, base.tripDurationH);
	if (p.has('mn')) base.tripMinMin = clampHalfHour(p.get('mn'), base.tripMinMin);
	if (p.has('mx')) base.tripMaxMin = clampHalfHour(p.get('mx'), base.tripMaxMin);
	for (const key of ['today', 'tomorrow', 'd2'] as DayKey[]) {
		const iv = p.get('iv_' + key);
		if (iv) base.intervals[key] = parseOverride(iv);
	}
	const hl = p.get('hl');
	if (hl && /^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(hl)) base.highlight = hl;
	return base;
}

function decodeLegacyBlob(b64: string): ViewState | null {
	try {
		const obj = JSON.parse(urlSafeB64Decode(b64)) as Record<string, unknown>;
		const base = defaultState();
		const expandedRaw = Array.isArray(obj.e) ? obj.e : [];
		const expanded = new Set<string>(
			expandedRaw.filter((s): s is string => typeof s === 'string' && /^\d{2}$/.test(s))
		);
		const intervalsRaw = obj.iv as Record<string, unknown> | undefined;
		const decodeIv = (raw: unknown): DayOverride => {
			if (!raw || typeof raw !== 'object') return { min: null, max: null, durationH: null, mode: null };
			const r = raw as Record<string, unknown>;
			return {
				min: r.min === null || r.min === undefined ? null : clampHalfHour(r.min, 0),
				max: r.max === null || r.max === undefined ? null : clampHalfHour(r.max, 1380),
				durationH: r.durationH === null || r.durationH === undefined ? null : clampMin(r.durationH, 1, 12, 2),
				mode: isMode(r.mode) ? r.mode : null
			};
		};
		const tupleToPoint = (t: unknown): LabeledPoint | null => {
			if (!Array.isArray(t) || t.length < 2) return null;
			const lat = Number(t[0]);
			const lon = Number(t[1]);
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
			if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
			const label = typeof t[2] === 'string' ? t[2] : undefined;
			return { lat, lon, label };
		};
		const hl = obj.hl;
		return {
			tab: isTab(obj.t) ? obj.t : base.tab,
			from: tupleToPoint(obj.f),
			to: tupleToPoint(obj.o),
			at: tupleToPoint(obj.a),
			day: isDay(obj.d) ? obj.d : base.day,
			expanded,
			tripMode: coerceMode(obj.md, base.tripMode),
			tripDurationH: clampMin(obj.dh, 1, 12, base.tripDurationH),
			tripMinMin: clampHalfHour(obj.mn, base.tripMinMin),
			tripMaxMin: clampHalfHour(obj.mx, base.tripMaxMin),
			intervals: {
				today: decodeIv(intervalsRaw?.today),
				tomorrow: decodeIv(intervalsRaw?.tomorrow),
				d2: decodeIv(intervalsRaw?.d2)
			},
			highlight: typeof hl === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(hl) ? hl : null
		};
	} catch {
		return null;
	}
}

function decodeLegacyQS(search: URLSearchParams): ViewState {
	const base = defaultState();
	const tab = search.get('tab');
	if (isTab(tab)) base.tab = tab;
	const day = search.get('day');
	if (isDay(day)) base.day = day;
	const parseLegacyPoint = (raw: string | null, labelKey: string): LabeledPoint | null => {
		if (!raw) return null;
		const parts = raw.split(',');
		const lat = Number(parts[0]);
		const lon = Number(parts[1]);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
		const labelRaw = search.get(labelKey);
		return { lat, lon, label: labelRaw ? decodeURIComponent(labelRaw) : undefined };
	};
	base.from = parseLegacyPoint(search.get('from'), 'label_from');
	base.to = parseLegacyPoint(search.get('to'), 'label_to');
	base.at = parseLegacyPoint(search.get('at'), 'label_at');
	return base;
}

export function decodeView(params: URLSearchParams): ViewState {
	const blob = params.get('s');
	if (blob) {
		const decoded = decodeLegacyBlob(blob);
		if (decoded) return decoded;
	}
	if (params.has('tab') || params.has('from') || params.has('to') || params.has('at')) {
		return decodeLegacyQS(params);
	}
	return decodeShortKeys(params);
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
