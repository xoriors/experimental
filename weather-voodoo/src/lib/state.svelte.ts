import type { DayKey, TripMode, ViewState } from './types';

const initial: ViewState = {
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

export const view = $state<ViewState>({
	...initial,
	expanded: new Set(initial.expanded),
	intervals: {
		today: { ...initial.intervals.today },
		tomorrow: { ...initial.intervals.tomorrow },
		d2: { ...initial.intervals.d2 }
	}
});

export function setView(next: ViewState): void {
	view.tab = next.tab;
	view.from = next.from;
	view.to = next.to;
	view.at = next.at;
	view.day = next.day;
	view.expanded = new Set(next.expanded);
	view.tripMode = next.tripMode;
	view.tripDurationH = next.tripDurationH;
	view.tripMinMin = next.tripMinMin;
	view.tripMaxMin = next.tripMaxMin;
	view.intervals = {
		today: { ...next.intervals.today },
		tomorrow: { ...next.intervals.tomorrow },
		d2: { ...next.intervals.d2 }
	};
	view.highlight = next.highlight;
}

export function toggleExpanded(slot: string): void {
	const next = new Set(view.expanded);
	if (next.has(slot)) next.delete(slot);
	else next.add(slot);
	view.expanded = next;
}

export type EffectiveDayConfig = {
	min: number;
	max: number;
	durationH: number;
	mode: TripMode;
};

export function effectiveConfig(day: DayKey): EffectiveDayConfig {
	const o = view.intervals[day];
	return {
		min: o.min ?? view.tripMinMin,
		max: o.max ?? view.tripMaxMin,
		durationH: o.durationH ?? view.tripDurationH,
		mode: o.mode ?? view.tripMode
	};
}

export function setDayOverride(
	day: DayKey,
	patch: Partial<{ min: number | null; max: number | null; durationH: number | null; mode: TripMode | null }>
): void {
	view.intervals = {
		...view.intervals,
		[day]: { ...view.intervals[day], ...patch }
	};
}

export function resetDayOverride(day: DayKey): void {
	view.intervals = {
		...view.intervals,
		[day]: { min: null, max: null, durationH: null, mode: null }
	};
}
