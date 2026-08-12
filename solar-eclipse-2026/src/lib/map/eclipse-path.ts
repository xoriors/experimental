/**
 * Turning the eclipse geometry into things that can be drawn on a map: the
 * swath of totality, the centre line, the umbra's outline at a given moment,
 * and a grid of how deep the partial eclipse gets across the rest of Europe.
 */

import {
	centralLinePoint,
	umbraOutline,
	utcToT,
	tToUtc,
	type SurfacePoint
} from '../eclipse/besselian';
import { haversineKm, localCircumstances, maximumDepth } from '../eclipse/local';

export type LngLat = [number, number];

function bracket(test: (t: number) => boolean): { start: number; end: number } {
	let first = NaN;
	let last = NaN;
	for (let t = -4; t <= 4; t += 1 / 240) {
		if (test(t)) {
			if (Number.isNaN(first)) first = t;
			last = t;
		}
	}
	const refine = (inside: number, outside: number) => {
		let a = inside;
		let b = outside;
		for (let i = 0; i < 40; i++) {
			const mid = (a + b) / 2;
			if (test(mid)) a = mid;
			else b = mid;
		}
		return a;
	};
	return {
		start: refine(first, first - 1 / 240),
		end: refine(last, last + 1 / 240)
	};
}

/**
 * When the shadow *axis* meets the Earth — the span over which a centre line
 * exists. The umbra itself arrives a little earlier and leaves a little later,
 * grazing the limb before the axis lands; see `umbraContactRange`.
 */
export function axisOnEarthRange(): { start: number; end: number } {
	return bracket((t) => centralLinePoint(t) !== null);
}

/**
 * First and last umbral contact: when any part of the umbra touches the Earth,
 * which is where the path of totality genuinely begins and ends.
 */
export function umbraContactRange(): { start: number; end: number } {
	return bracket((t) => umbraOutline(t, 48) !== null);
}

export interface PathSample {
	t: number;
	time: Date;
	centre: SurfacePoint;
	north: LngLat;
	south: LngLat;
	/** Width of the path measured across the shadow, km. */
	widthKm: number;
	/** Duration of totality on the centre line, seconds. */
	durationSeconds: number;
	/** Sun altitude on the centre line, degrees. */
	sunAltitude: number;
	/** Ground speed of the umbra, km/s. */
	speedKmS: number;
}

/**
 * Sample the path at regular intervals. The northern and southern edges are
 * taken from the true umbral outline rather than from a circle in the
 * fundamental plane, because near sunrise and sunset the umbra is stretched into
 * a long ellipse and the simple approximation stops being meaningful.
 */
export function samplePath(stepSeconds = 60): PathSample[] {
	const { start, end } = axisOnEarthRange();
	const step = stepSeconds / 3600;
	const samples: PathSample[] = [];

	for (let t = start + step / 2; t < end; t += step) {
		const centre = centralLinePoint(t);
		if (!centre) continue;

		// Local heading of the centre line, used to find the across-path direction.
		const ahead = centralLinePoint(Math.min(end, t + step / 4));
		const behind = centralLinePoint(Math.max(start, t - step / 4));
		if (!ahead || !behind) continue;
		const headingX = (ahead.lon - behind.lon) * Math.cos((centre.lat * Math.PI) / 180);
		const headingY = ahead.lat - behind.lat;
		const headingLength = Math.hypot(headingX, headingY) || 1;
		// Unit vector across the path, pointing to the left of travel.
		const acrossX = -headingY / headingLength;
		const acrossY = headingX / headingLength;

		const ring = umbraOutline(t, 180);
		if (!ring) continue;

		let minProjection = Infinity;
		let maxProjection = -Infinity;
		let minPoint: LngLat = ring[0];
		let maxPoint: LngLat = ring[0];
		for (const [lon, lat] of ring) {
			let dLon = lon - centre.lon;
			if (dLon > 180) dLon -= 360;
			if (dLon < -180) dLon += 360;
			const projection =
				dLon * Math.cos((centre.lat * Math.PI) / 180) * acrossX + (lat - centre.lat) * acrossY;
			if (projection < minProjection) {
				minProjection = projection;
				minPoint = [lon, lat];
			}
			if (projection > maxProjection) {
				maxProjection = projection;
				maxPoint = [lon, lat];
			}
		}

		// Label the edges by which side of the shadow's travel they are on, not by
		// which has the greater latitude. The track curves sharply near the pole,
		// and a latitude test flips the two over there, which turns every quad
		// drawn between consecutive samples into a bow tie.
		const north = maxPoint; // left of travel, which is north for most of the track
		const south = minPoint;

		const local = localCircumstances({ lat: centre.lat, lon: centre.lon });

		samples.push({
			t,
			time: tToUtc(t),
			centre,
			north,
			south,
			widthKm: haversineKm(
				{ lat: maxPoint[1], lon: maxPoint[0] },
				{ lat: minPoint[1], lon: minPoint[0] }
			),
			durationSeconds: local.totalitySeconds,
			sunAltitude: local.max.altitude,
			speedKmS: speedAt(t)
		});
	}

	return samples;
}

/** Ground speed of the umbra in km/s at time `t`. */
export function speedAt(t: number): number {
	const dt = 5 / 3600;
	const a = centralLinePoint(t - dt);
	const b = centralLinePoint(t + dt);
	if (!a || !b) return 0;
	return haversineKm(a, b) / (2 * dt * 3600);
}

/** A closed polygon covering the whole path of totality. */
export function pathPolygon(samples: PathSample[]): LngLat[] {
	const north = samples.map((s) => s.north);
	const south = samples.map((s) => s.south).reverse();
	return [...north, ...south];
}

/**
 * The umbra's outline on the ground at a given instant.
 *
 * `steps` is worth choosing to suit the zoom. The shadow is about 300 km across,
 * which on a map of the whole track is some twenty pixels wide: at 160 points
 * that is eight points per pixel, recomputed every animation frame, for an
 * ellipse nobody can see the sides of.
 */
export function umbraAt(t: number, steps = 160): LngLat[] | null {
	return umbraOutline(t, steps);
}

export interface ObscurationGrid {
	lonMin: number;
	lonMax: number;
	latMin: number;
	latMax: number;
	stepLon: number;
	stepLat: number;
	cols: number;
	rows: number;
	/** Maximum fraction of the Sun's area covered, row-major from latMax down. */
	values: Float32Array;
}

/**
 * Greatest obscuration reached at each point of a lat/lon grid. Used to shade
 * the map so that someone in Paris or Berlin can see what they get, rather than
 * only showing the narrow band that gets totality.
 */
export function computeObscurationGrid(
	lonMin = -75,
	lonMax = 50,
	latMin = 20,
	latMax = 84,
	step = 1
): ObscurationGrid {
	const cols = Math.round((lonMax - lonMin) / step) + 1;
	const rows = Math.round((latMax - latMin) / step) + 1;
	const values = new Float32Array(cols * rows);

	for (let row = 0; row < rows; row++) {
		const lat = latMax - row * step;
		for (let col = 0; col < cols; col++) {
			const lon = lonMin + col * step;
			const deepest = maximumDepth({ lat, lon });
			// An eclipse below the horizon is no eclipse at all, but fade the
			// cut-off over a couple of degrees rather than stepping to zero: the
			// Sun sets gradually and a hard edge on the map looks like an error.
			const visible = Math.max(0, Math.min(1, (deepest.altitude + 0.6) / 2.5));
			values[row * cols + col] = deepest.obscuration * visible;
		}
	}

	return { lonMin, lonMax, latMin, latMax, stepLon: step, stepLat: step, cols, rows, values };
}

/** Bilinear sample of the obscuration grid. */
export function sampleGrid(grid: ObscurationGrid, lon: number, lat: number): number {
	const x = (lon - grid.lonMin) / grid.stepLon;
	const y = (grid.latMax - lat) / grid.stepLat;
	if (x < 0 || y < 0 || x > grid.cols - 1 || y > grid.rows - 1) return 0;
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = Math.min(grid.cols - 1, x0 + 1);
	const y1 = Math.min(grid.rows - 1, y0 + 1);
	const fx = x - x0;
	const fy = y - y0;
	const v00 = grid.values[y0 * grid.cols + x0];
	const v10 = grid.values[y0 * grid.cols + x1];
	const v01 = grid.values[y1 * grid.cols + x0];
	const v11 = grid.values[y1 * grid.cols + x1];
	return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

/** Convenience: the instant the umbra reaches a given place, or null. */
export function totalityMidpoint(lat: number, lon: number): Date | null {
	const local = localCircumstances({ lat, lon });
	if (!local.isTotal || !local.c2 || !local.c3) return null;
	return tToUtc((local.c2.t + local.c3.t) / 2);
}

export { utcToT };
