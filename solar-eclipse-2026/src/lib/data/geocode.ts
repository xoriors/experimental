/**
 * Worldwide place search.
 *
 * The curated list in places.ts only covers the path and a few capitals, which
 * is useless if you live somewhere else — and for this eclipse "somewhere else"
 * matters enormously. Bucharest sees a 0.4% nibble at sunset while Baia Mare,
 * 350 km north-west in the same country, gets a third of the Sun covered. People
 * need to be able to look up their own town.
 *
 * Uses Open-Meteo's geocoding endpoint, which is built on GeoNames: no API key,
 * CORS enabled, and it returns ground elevation, which matters when the Sun is
 * within a degree of the horizon.
 */

const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

export interface GeocodedPlace {
	id: number;
	name: string;
	/** Region or state, for telling the four Springfields apart. */
	admin: string;
	country: string;
	lat: number;
	lon: number;
	/** Ground elevation in metres; 0 when the service does not know. */
	elevation: number;
	population?: number;
}

interface RawResult {
	id: number;
	name: string;
	latitude: number;
	longitude: number;
	elevation?: number;
	country?: string;
	admin1?: string;
	admin2?: string;
	population?: number;
	feature_code?: string;
}

/** Feature codes that denote a populated place rather than an airport or a hill. */
function isSettlement(code: string | undefined): boolean {
	return code === undefined || code.startsWith('PPL');
}

export class GeocodeError extends Error {}

/** Give up on a silent network rather than spinning forever. */
const TIMEOUT_MS = 8000;

/**
 * Look up places by name. Pass an AbortSignal so that keystrokes cancel the
 * request they superseded; a separate timeout guards against a connection that
 * neither answers nor fails, which would otherwise leave the box saying
 * "searching" indefinitely.
 */
export async function searchPlaces(
	query: string,
	signal?: AbortSignal,
	limit = 8
): Promise<GeocodedPlace[]> {
	const trimmed = query.trim();
	if (trimmed.length < 2) return [];

	const url = `${ENDPOINT}?name=${encodeURIComponent(trimmed)}&count=${limit * 2}&language=en&format=json`;

	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
	const onOuterAbort = () => timeout.abort();
	signal?.addEventListener('abort', onOuterAbort);

	let response: Response;
	try {
		response = await fetch(url, { signal: timeout.signal });
	} catch (error) {
		// Only a genuine caller-initiated abort should propagate as one; a
		// timeout has to surface as an error the user can see.
		if (signal?.aborted) throw error;
		throw new GeocodeError('Could not reach the place search service.');
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onOuterAbort);
	}
	if (!response.ok) throw new GeocodeError(`Place search failed (${response.status}).`);

	const body = (await response.json()) as { results?: RawResult[] };
	const results = body.results ?? [];

	return results
		.filter((r) => isSettlement(r.feature_code))
		.slice(0, limit)
		.map((r) => ({
			id: r.id,
			name: r.name,
			admin: [r.admin1, r.admin2].filter((part) => part && part !== r.name)[0] ?? '',
			country: r.country ?? '',
			lat: r.latitude,
			lon: r.longitude,
			elevation: Number.isFinite(r.elevation) ? (r.elevation as number) : 0,
			population: r.population
		}));
}

/** Rough separation in kilometres, for spotting duplicates between sources. */
export function roughDistanceKm(
	a: { lat: number; lon: number },
	b: { lat: number; lon: number }
): number {
	const dLat = (a.lat - b.lat) * 111.19;
	const dLon = (a.lon - b.lon) * 111.19 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
	return Math.hypot(dLat, dLon);
}
