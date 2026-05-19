import type { ViewState } from './types';

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
	highlight: null
};

export const view = $state<ViewState>({ ...initial, expanded: new Set(initial.expanded) });

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
	view.highlight = next.highlight;
}

export function toggleExpanded(slot: string): void {
	const next = new Set(view.expanded);
	if (next.has(slot)) next.delete(slot);
	else next.add(slot);
	view.expanded = next;
}
