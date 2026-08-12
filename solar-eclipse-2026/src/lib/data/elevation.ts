/**
 * Ground elevation for arbitrary coordinates, from Open-Meteo's elevation
 * endpoint (Copernicus DEM at 90 m, keyless, CORS). Used to work out whether a
 * hill stands between a viewing spot and the setting Sun.
 */

import type { Point } from '../eclipse/horizon';

const ENDPOINT = 'https://api.open-meteo.com/v1/elevation';
/** The API accepts a hundred coordinates per call. */
const BATCH = 100;
const TIMEOUT_MS = 15000;

export class ElevationError extends Error {}

async function fetchBatch(points: Point[], signal?: AbortSignal): Promise<number[]> {
	const latitudes = points.map((p) => p.lat.toFixed(5)).join(',');
	const longitudes = points.map((p) => p.lon.toFixed(5)).join(',');
	const url = `${ENDPOINT}?latitude=${latitudes}&longitude=${longitudes}`;

	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
	const onAbort = () => timeout.abort();
	signal?.addEventListener('abort', onAbort);

	let response: Response;
	try {
		response = await fetch(url, { signal: timeout.signal });
	} catch (error) {
		if (signal?.aborted) throw error;
		throw new ElevationError('Could not reach the elevation service.');
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}

	if (response.status === 429) throw new RateLimited();
	if (!response.ok) throw new ElevationError(`Elevation lookup failed (${response.status}).`);
	const body = (await response.json()) as { elevation?: number[] };
	if (!Array.isArray(body.elevation)) throw new ElevationError('Elevation service returned no data.');
	return body.elevation;
}

class RateLimited extends Error {}

const delay = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			reject(new DOMException('aborted', 'AbortError'));
		});
	});

/** One batch, backing off if the free service asks us to slow down. */
async function fetchBatchWithRetry(points: Point[], signal?: AbortSignal): Promise<number[]> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fetchBatch(points, signal);
		} catch (error) {
			if (!(error instanceof RateLimited) || attempt >= 2) {
				if (error instanceof RateLimited) {
					throw new ElevationError('The elevation service is busy — try again in a minute.');
				}
				throw error;
			}
			await delay(1200 * (attempt + 1), signal);
		}
	}
}

/**
 * Elevations for any number of points, in the order given. Batches are issued
 * in sequence rather than in parallel to stay polite to a free service.
 */
export async function elevationsFor(points: Point[], signal?: AbortSignal): Promise<number[]> {
	if (!points.length) return [];
	const out: number[] = [];
	for (let i = 0; i < points.length; i += BATCH) {
		const chunk = points.slice(i, i + BATCH);
		const values = await fetchBatchWithRetry(chunk, signal);
		// Pad defensively: a short reply should not silently shift every later
		// sample onto the wrong coordinate.
		for (let j = 0; j < chunk.length; j++) {
			out.push(Number.isFinite(values[j]) ? values[j] : Number.NaN);
		}
	}
	return out;
}
