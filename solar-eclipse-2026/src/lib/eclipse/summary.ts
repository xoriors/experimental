/**
 * A one-line verdict for a place, short enough to sit in a search result.
 * Lets someone typing "Romania" see at a glance that Baia Mare is worth the
 * trip and Constanta is not.
 */

import { localCircumstances } from './local';
import { formatDuration } from '../format';

export type VisibilityKind = 'total' | 'partial' | 'sunset' | 'none';

export interface VisibilitySummary {
	kind: VisibilityKind;
	label: string;
}

export function summariseVisibility(lat: number, lon: number, elevation = 0): VisibilitySummary {
	const local = localCircumstances({ lat, lon, elevation });

	if (!local.hasEclipse || local.belowHorizon || local.visibleObscuration < 0.005) {
		return { kind: 'none', label: 'Not visible' };
	}

	if (local.isTotal) {
		return { kind: 'total', label: `Totality ${formatDuration(local.totalitySeconds)}` };
	}

	const percent = Math.round(local.visibleObscuration * 100);
	if (local.partlyBelowHorizon) {
		return { kind: 'sunset', label: `${percent}% at sunset` };
	}
	return { kind: 'partial', label: `${percent}% covered` };
}
