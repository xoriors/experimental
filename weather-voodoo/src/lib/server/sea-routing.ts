import { seaRoute, SnapFailedError, NoRouteError } from 'searoute-ts';
import type { LatLng } from '$lib/types';

export type SeaRouteResult = {
	polyline: LatLng[];
	lengthKm: number;
	greatCircleKm: number;
	detourRatio: number;
};

/**
 * Compute the shortest maritime route between two points using Eurostat's
 * marnet (via searoute-ts). Returns null when either endpoint can't be
 * snapped to the network (e.g. inland), no path exists, or the snap distance
 * is far enough that the result wouldn't be a meaningful sea route — caller
 * should fall back to a straight line in that case.
 *
 * `maxSnapKm` guards against snapping a deeply inland location to a faraway
 * coast (which would look correct but be nonsense). 50 km covers harbours
 * and near-coast pickups.
 */
export function computeSeaRoute(
	from: LatLng,
	to: LatLng,
	maxSnapKm = 50
): SeaRouteResult | null {
	try {
		const route = seaRoute([from.lon, from.lat], [to.lon, to.lat], { units: 'kilometers' });
		const { length, greatCircleLength, detourRatio, originSnapKm, destinationSnapKm } =
			route.properties;
		if (originSnapKm > maxSnapKm || destinationSnapKm > maxSnapKm) return null;
		const coords = route.geometry.coordinates;
		if (!coords || coords.length < 2) return null;
		const polyline: LatLng[] = coords.map(([lon, lat]) => ({ lat, lon }));
		return {
			polyline,
			lengthKm: length,
			greatCircleKm: greatCircleLength,
			detourRatio
		};
	} catch (e) {
		if (e instanceof SnapFailedError) return null;
		if (e instanceof NoRouteError) return null;
		throw e;
	}
}
