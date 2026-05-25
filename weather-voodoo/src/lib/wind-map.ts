/**
 * Helpers that turn the API's per-sample-point wind timeseries into the
 * data shape MapView's chevron overlay consumes (and a small verdict string
 * for the scrubber overlay).
 */
import type { WindChevron } from './components/MapView.svelte';
import type { WindSample } from './types';
import { classifyRelativeWind, relativeWindDeg, type RelativeWindClass } from './wind';

/**
 * Pick the chevron data for a specific hour. Returns null if the hour is not
 * present in any sample's timeseries (e.g. samples disagree on hour range).
 */
export function chevronsForHour(
	samples: WindSample[],
	time: string,
	classLabel: (cls: RelativeWindClass) => string
): WindChevron[] {
	const out: WindChevron[] = [];
	for (const s of samples) {
		const h = s.hours.find((x) => x.time === time);
		if (!h) continue;
		const rel = relativeWindDeg(h.windDirDeg, s.headingDeg);
		const cls = classifyRelativeWind(rel);
		out.push({
			point: s.point,
			headingDeg: s.headingDeg,
			windDirDeg: h.windDirDeg,
			windKn: h.windKn,
			relWindDeg: rel,
			cls,
			classLabel: classLabel(cls)
		});
	}
	return out;
}

/**
 * Pick the default scrubber hour: the first hour timestamp that is
 * >= the current wall clock. Falls back to the first hour if all are past.
 * Hour strings are local ISO ("YYYY-MM-DDTHH:00") in the destination's
 * timezone; for picking "now" we compare to local UTC-ish wall clock which
 * is good enough for the common case where the user is at/near the route.
 */
export function pickNowHour(hourTimes: string[]): string | null {
	if (hourTimes.length === 0) return null;
	const now = new Date();
	// Match local-ish format YYYY-MM-DDTHH:00 against `now`.
	const pad = (n: number) => n.toString().padStart(2, '0');
	const nowIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:00`;
	for (const t of hourTimes) {
		if (t >= nowIso) return t;
	}
	return hourTimes[0];
}

/**
 * Tiny natural-language verdict for the scrubber: the worst relative-wind
 * class observed across all chevrons at the selected hour. Picks vocabulary
 * keyed by class — caller maps to localized strings.
 */
export function worstClass(chevrons: WindChevron[]): RelativeWindClass | null {
	if (chevrons.length === 0) return null;
	const order: RelativeWindClass[] = ['head', 'head-cross', 'cross', 'tail-cross', 'tail'];
	let worst: RelativeWindClass = 'tail';
	for (const c of chevrons) {
		if (order.indexOf(c.cls) < order.indexOf(worst)) worst = c.cls;
	}
	return worst;
}
