import type { DayKey, ViewState } from './types';

const initial: ViewState = {
	tab: 'route',
	from: null,
	to: null,
	at: null,
	day: 'today',
	expanded: new Set<string>(),
	tripMode: 'auto',
	tripDurationH: 2,
	tripMinHour: 0,
	tripMaxHour: 23,
	intervals: {
		today: { min: null, max: null },
		tomorrow: { min: null, max: null },
		d2: { min: null, max: null }
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
	view.tripMinHour = next.tripMinHour;
	view.tripMaxHour = next.tripMaxHour;
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

export function effectiveInterval(day: DayKey): { min: number; max: number } {
	const override = view.intervals[day];
	return {
		min: override.min ?? view.tripMinHour,
		max: override.max ?? view.tripMaxHour
	};
}

export function setDayInterval(day: DayKey, min: number | null, max: number | null): void {
	view.intervals = {
		...view.intervals,
		[day]: { min, max }
	};
}

export function resetDayInterval(day: DayKey): void {
	setDayInterval(day, null, null);
}
