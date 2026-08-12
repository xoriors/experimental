/**
 * Deciding whether an Overpass instance actually answered the question.
 *
 * Two failure modes look like success from the outside, and both would reach
 * the user as "no viewing spots found" — which reads as an answer rather than
 * as a fault:
 *
 * - An overloaded instance returns 200 with an empty result and explains
 *   itself in a `remark` field.
 * - A regional mirror such as overpass.osm.ch happily serves anywhere in the
 *   world but only holds data for its own country, so everywhere else comes
 *   back empty. It gives itself away by reporting the database age as a bare
 *   number instead of a date.
 *
 * Mirrors also drift out of date without saying so — kumi.systems was three
 * months behind when this was written, which is tolerable for car parks and
 * hilltops but not indefinitely, so an abandoned copy is refused outright.
 */

export interface OverpassBody {
	elements?: unknown[];
	remark?: string;
	osm3s?: { timestamp_osm_base?: string };
}

export type HealthVerdict = { ok: true; ageDays?: number } | { ok: false; reason: string };

/**
 * Generous on purpose. A few months behind still knows about the viewpoints and
 * car parks this site asks for, and a working stale mirror beats no mirror; a
 * year behind means nobody is running it any more.
 */
const MAX_DATABASE_AGE_MS = 365 * 24 * 3600 * 1000;

export function looksHealthy(body: OverpassBody, now: number = Date.now()): HealthVerdict {
	if (body.remark && /timed out|runtime error|out of memory/i.test(body.remark)) {
		return { ok: false, reason: body.remark.trim() };
	}

	const stamp = body.osm3s?.timestamp_osm_base;
	if (stamp === undefined) return { ok: true };

	// Insist on an ISO date rather than trusting Date.parse, which cheerfully
	// reads the bare "116339" a regional mirror returns as the year 116339.
	const parsed = /^\d{4}-\d{2}-\d{2}T/.test(stamp) ? Date.parse(stamp) : Number.NaN;
	if (Number.isNaN(parsed)) {
		return { ok: false, reason: `mirror reported an unusable database timestamp (${stamp})` };
	}

	const ageMs = now - parsed;
	if (ageMs > MAX_DATABASE_AGE_MS) {
		const years = (ageMs / (365 * 24 * 3600 * 1000)).toFixed(1);
		return { ok: false, reason: `mirror's copy of OpenStreetMap is ${years} years out of date` };
	}

	return { ok: true, ageDays: Math.max(0, Math.round(ageMs / 86400000)) };
}
