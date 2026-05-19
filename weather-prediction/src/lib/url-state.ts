import type { DayKey, LabeledPoint, Tab, TripMode, ViewState } from './types';

const ROUND = 4;

function fmt(n: number): string {
	return n.toFixed(ROUND);
}

function parsePoint(raw: string | null, labelRaw: string | null): LabeledPoint | null {
	if (!raw) return null;
	const parts = raw.split(',');
	if (parts.length !== 2) return null;
	const lat = Number(parts[0]);
	const lon = Number(parts[1]);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
	const label = labelRaw ? decodeURIComponent(labelRaw) : undefined;
	return { lat, lon, label };
}

function pointToParam(p: LabeledPoint): string {
	return `${fmt(p.lat)},${fmt(p.lon)}`;
}

function isTab(x: string | null): x is Tab {
	return x === 'route' || x === 'fixed';
}

function isDay(x: string | null): x is DayKey {
	return x === 'today' || x === 'tomorrow' || x === 'd2';
}

function isMode(x: string | null): x is TripMode {
	return x === 'auto' || x === 'sea' || x === 'land';
}

function parseDuration(raw: string | null): number {
	const n = Number(raw);
	if (!Number.isFinite(n)) return 2;
	return Math.max(1, Math.min(12, Math.round(n)));
}

function parseMinHour(raw: string | null): number {
	const n = Number(raw);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(23, Math.round(n)));
}

export function decodeView(search: URLSearchParams): ViewState {
	const tab: Tab = isTab(search.get('tab')) ? (search.get('tab') as Tab) : 'route';
	const day: DayKey = isDay(search.get('day')) ? (search.get('day') as DayKey) : 'today';

	const from = parsePoint(search.get('from'), search.get('label_from'));
	const to = parsePoint(search.get('to'), search.get('label_to'));
	const at = parsePoint(search.get('at'), search.get('label_at'));

	const expandRaw = search.get('expand') ?? '';
	const expanded = new Set<string>(
		expandRaw
			.split(',')
			.map((s) => s.trim())
			.filter((s) => /^\d{2}$/.test(s))
	);

	const tripMode: TripMode = isMode(search.get('mode')) ? (search.get('mode') as TripMode) : 'auto';
	const tripDurationH = search.has('dur') ? parseDuration(search.get('dur')) : 2;
	const tripMinHour = search.has('minh') ? parseMinHour(search.get('minh')) : 0;
	const hlRaw = search.get('hl');
	const highlight = hlRaw && /^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(hlRaw) ? hlRaw : null;

	return { tab, from, to, at, day, expanded, tripMode, tripDurationH, tripMinHour, highlight };
}

export function encodeView(v: ViewState): string {
	const params = new URLSearchParams();
	params.set('tab', v.tab);
	params.set('day', v.day);

	if (v.tab === 'route') {
		if (v.from) {
			params.set('from', pointToParam(v.from));
			if (v.from.label) params.set('label_from', encodeURIComponent(v.from.label));
		}
		if (v.to) {
			params.set('to', pointToParam(v.to));
			if (v.to.label) params.set('label_to', encodeURIComponent(v.to.label));
		}
	} else {
		if (v.at) {
			params.set('at', pointToParam(v.at));
			if (v.at.label) params.set('label_at', encodeURIComponent(v.at.label));
		}
	}

	if (v.expanded.size > 0) {
		const sorted = [...v.expanded].sort();
		params.set('expand', sorted.join(','));
	}

	if (v.tripMode !== 'auto') params.set('mode', v.tripMode);
	if (v.tripDurationH !== 2) params.set('dur', String(v.tripDurationH));
	if (v.tripMinHour !== 0) params.set('minh', String(v.tripMinHour));
	if (v.highlight) params.set('hl', v.highlight);

	return params.toString();
}

export function viewsEqual(a: ViewState, b: ViewState): boolean {
	return encodeView(a) === encodeView(b);
}
