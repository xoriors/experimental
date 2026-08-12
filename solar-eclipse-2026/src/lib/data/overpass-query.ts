/**
 * The Overpass query behind the viewpoint finder.
 *
 * It lives here rather than in `+server.ts` partly because SvelteKit will not
 * take arbitrary exports from an endpoint, and partly because the shape of this
 * query is the one thing that decides whether the feature works at all.
 * Overpass is a free shared service: it answers a query it considers too
 * expensive not with data but with a gateway 504, which is exactly what the
 * deployed site was getting. Every clause below is therefore anchored on a
 * selective tag and given the smallest radius that still makes sense for
 * something you would drive to before sunset.
 */

export type QueryTier = 'full' | 'lean';

export const MIN_RADIUS_M = 2000;
export const MAX_RADIUS_M = 80000;

interface TierShape {
	/** Radius cap for the rare things worth driving the whole way for. */
	wide: number;
	/** Radius cap for terraces, hotels and parks, which are everywhere. */
	venue: number;
	/** Radius cap for car parks — nobody drives an hour to one. */
	parking: number;
	limit: number;
	/** Overpass's own runtime limit, in seconds. */
	timeoutS: number;
}

const TIERS: Record<QueryTier, TierShape> = {
	full: { wide: MAX_RADIUS_M, venue: 25000, parking: 20000, limit: 250, timeoutS: 10 },
	/**
	 * Only used once the full query has failed on every mirror: the sorts that
	 * matter most, over a shorter drive, cheap enough that a struggling instance
	 * can still manage it. A reduced answer beats none, and the page says which
	 * it is showing.
	 */
	lean: { wide: 25000, venue: 12000, parking: 12000, limit: 120, timeoutS: 6 }
};

export function clampRadius(radiusM: number): number {
	return Math.min(Math.max(Math.round(radiusM), MIN_RADIUS_M), MAX_RADIUS_M);
}

/** How long Overpass itself is allowed to spend on a query of this tier. */
export function tierTimeoutMs(tier: QueryTier): number {
	return TIERS[tier].timeoutS * 1000;
}

export function buildQuery(
	lat: number,
	lon: number,
	radiusM: number,
	tier: QueryTier = 'full'
): string {
	const shape = TIERS[tier];
	const radius = clampRadius(radiusM);
	const at = `${lat},${lon}`;
	const wide = `${Math.min(radius, shape.wide)},${at}`;
	const venue = `${Math.min(radius, shape.venue)},${at}`;
	const parking = `${Math.min(radius, shape.parking)},${at}`;

	// `nwr` rather than paired node/way statements: half as many clauses for
	// Overpass to plan, and it picks up the multipolygon parks and hotel grounds
	// that a node-only query walks straight past.
	const clauses =
		tier === 'full'
			? [
					`nwr["tourism"="viewpoint"](around:${wide});`,
					`node["tourism"="picnic_site"](around:${wide});`,
					`node["highway"~"^(rest_area|services)$"](around:${wide});`,
					// Named peaks only. In the Carpathians or the Pyrenees the unnamed
					// ones run to thousands, and a summit the card cannot name is no use
					// to anybody trying to find it in the dark.
					`node["natural"="peak"]["name"](around:${wide});`,
					// `outdoor_seating` leads because it is far the more selective of the
					// two tags, and Overpass plans on the first one it can index.
					`nwr["outdoor_seating"="yes"]["amenity"~"^(restaurant|cafe|bar|pub)$"](around:${venue});`,
					`nwr["amenity"="biergarten"](around:${venue});`,
					`nwr["tourism"~"^(hotel|guest_house|chalet|alpine_hut|wilderness_hut|camp_site|caravan_site)$"]["name"](around:${venue});`,
					`nwr["leisure"~"^(park|garden)$"]["name"](around:${venue});`,
					`nwr["amenity"="parking"]["name"](around:${parking});`
				]
			: [
					`nwr["tourism"="viewpoint"](around:${wide});`,
					`node["natural"="peak"]["name"](around:${wide});`,
					`nwr["outdoor_seating"="yes"]["amenity"~"^(restaurant|cafe|bar|pub)$"](around:${venue});`,
					`nwr["amenity"="parking"]["name"](around:${parking});`
				];

	// Modifier order is verbosity, then geometry, then limit — the form every
	// instance's parser accepts.
	return `[out:json][timeout:${shape.timeoutS}];\n(\n  ${clauses.join('\n  ')}\n);\nout tags center ${shape.limit};`;
}
