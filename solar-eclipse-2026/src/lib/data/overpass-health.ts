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
 */

export interface OverpassBody {
	elements?: unknown[];
	remark?: string;
	osm3s?: { timestamp_osm_base?: string };
}

export type HealthVerdict = { ok: true } | { ok: false; reason: string };

export function looksHealthy(body: OverpassBody): HealthVerdict {
	if (body.remark && /timed out|runtime error|out of memory/i.test(body.remark)) {
		return { ok: false, reason: body.remark.trim() };
	}

	const stamp = body.osm3s?.timestamp_osm_base;
	// Insist on an ISO date rather than trusting Date.parse, which cheerfully
	// reads the bare "116339" a regional mirror returns as the year 116339.
	if (stamp !== undefined && !(/^\d{4}-\d{2}-\d{2}T/.test(stamp) && !Number.isNaN(Date.parse(stamp)))) {
		return { ok: false, reason: `mirror reported an unusable database timestamp (${stamp})` };
	}

	return { ok: true };
}
