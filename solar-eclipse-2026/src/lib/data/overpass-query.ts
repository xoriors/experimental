/**
 * The Overpass query behind the viewpoint finder.
 *
 * It lives here rather than in `+server.ts` partly because SvelteKit will not
 * take arbitrary exports from an endpoint, partly so both routes to Overpass —
 * our own endpoint and the browser's direct fallback — ask exactly the same
 * question, and partly because the shape of this query is the one thing that
 * decides whether the feature works at all. Overpass answers a query it
 * considers too expensive not with data but with a gateway 504.
 *
 * The expensive mistake was `(around:25000,lat,lon)`. It reads naturally and it
 * is what the documentation shows first, but combined with a tag regex it puts
 * the spatial test after the tag scan: the full query took 14 seconds and then
 * gave up with nothing. The same clauses with a bounding-box filter, which goes
 * through Overpass's spatial index, return 188 places in three. So every clause
 * here is bounded by a box, and the corners the box adds beyond the circle are
 * trimmed by real distance on the client, which has to measure it anyway.
 */

export type QueryTier = 'full' | 'lean';

export const MIN_RADIUS_M = 2000;
export const MAX_RADIUS_M = 80000;

const METRES_PER_DEGREE_LAT = 111320;

export interface BoundingBox {
	south: number;
	west: number;
	north: number;
	east: number;
}

/**
 * A box that contains the circle of `radiusM` about a point — so it holds
 * everything the circle does, and some corners besides.
 */
export function boundingBox(lat: number, lon: number, radiusM: number): BoundingBox {
	const dLat = radiusM / METRES_PER_DEGREE_LAT;
	// A degree of longitude shortens towards the poles. The cosine is floored so
	// that a search near a pole asks for a wide box rather than an infinite one.
	const dLon =
		radiusM / (METRES_PER_DEGREE_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.02));
	return {
		south: Math.max(lat - dLat, -90),
		north: Math.min(lat + dLat, 90),
		// Overpass takes no bounding box that crosses the antimeridian, so out
		// there the box is clipped rather than wrapped: the search loses the far
		// side of the line instead of failing outright.
		west: Math.max(lon - dLon, -180),
		east: Math.min(lon + dLon, 180)
	};
}

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
	full: { wide: MAX_RADIUS_M, venue: 25000, parking: 20000, limit: 250, timeoutS: 15 },
	/**
	 * Only used once the full query has failed on every mirror: the sorts that
	 * matter most, over a shorter drive, cheap enough that a struggling instance
	 * can still manage it. A reduced answer beats none, and the page says which
	 * it is showing.
	 */
	lean: { wide: 25000, venue: 12000, parking: 12000, limit: 120, timeoutS: 8 }
};

export function clampRadius(radiusM: number): number {
	return Math.min(Math.max(Math.round(radiusM), MIN_RADIUS_M), MAX_RADIUS_M);
}

export function buildQuery(
	lat: number,
	lon: number,
	radiusM: number,
	tier: QueryTier = 'full'
): string {
	const shape = TIERS[tier];
	const radius = clampRadius(radiusM);
	const within = (capM: number) => {
		const b = boundingBox(lat, lon, Math.min(radius, capM));
		return `(${b.south.toFixed(4)},${b.west.toFixed(4)},${b.north.toFixed(4)},${b.east.toFixed(4)})`;
	};
	const wide = within(shape.wide);
	const venue = within(shape.venue);
	const parking = within(shape.parking);

	// `nwr` rather than paired node/way statements: half as many clauses for
	// Overpass to plan, and it picks up the multipolygon parks and hotel grounds
	// that a node-only query walks straight past.
	const clauses =
		tier === 'full'
			? [
					`nwr["tourism"="viewpoint"]${wide};`,
					`node["tourism"="picnic_site"]${wide};`,
					`node["highway"~"^(rest_area|services)$"]${wide};`,
					// Named peaks only. In the Carpathians or the Pyrenees the unnamed
					// ones run to thousands, and a summit the card cannot name is no use
					// to anybody trying to find it in the dark.
					`node["natural"="peak"]["name"]${wide};`,
					`nwr["outdoor_seating"="yes"]["amenity"~"^(restaurant|cafe|bar|pub)$"]${venue};`,
					`nwr["amenity"="biergarten"]${venue};`,
					`nwr["tourism"~"^(hotel|guest_house|chalet|alpine_hut|wilderness_hut|camp_site|caravan_site)$"]["name"]${venue};`,
					`nwr["leisure"~"^(park|garden)$"]["name"]${venue};`,
					`nwr["amenity"="parking"]["name"]${parking};`
				]
			: [
					`nwr["tourism"="viewpoint"]${wide};`,
					`node["natural"="peak"]["name"]${wide};`,
					`nwr["outdoor_seating"="yes"]["amenity"~"^(restaurant|cafe|bar|pub)$"]${venue};`,
					`nwr["amenity"="parking"]["name"]${parking};`
				];

	// Modifier order is verbosity, then geometry, then limit — the form every
	// instance's parser accepts.
	return `[out:json][timeout:${shape.timeoutS}];\n(\n  ${clauses.join('\n  ')}\n);\nout tags center ${shape.limit};`;
}
