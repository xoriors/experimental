/**
 * The map's arithmetic, moved off the main thread.
 *
 * Solving the track costs about 200 ms and the obscuration grid about two
 * seconds on a desktop — call it ten to thirty on a phone. Done inline, as it
 * was, that is not a slow page but a frozen one: nothing paints, no spinner
 * appears, and the browser stops answering scrolls until it finishes. A worker
 * has no such effect on anybody, and it lets the map fill in as each piece
 * arrives instead of all at once at the end.
 *
 * The grid is computed twice on purpose. The coarse pass is a twentieth of the
 * work and, since the grid is sampled bilinearly anyway, looks very nearly the
 * same — so the shading appears almost at once and is quietly replaced by the
 * accurate version a couple of seconds later.
 */

import {
	computeObscurationGrid,
	samplePath,
	type ObscurationGrid,
	type PathSample
} from './eclipse-path';

export interface MapWorkRequest {
	pathStepSeconds: number;
	lonMin: number;
	lonMax: number;
	latMin: number;
	latMax: number;
	coarseStep: number;
	fineStep: number;
}

export type MapWorkMessage =
	| { kind: 'path'; path: PathSample[] }
	| { kind: 'grid'; grid: ObscurationGrid; final: boolean };

/**
 * Typed by hand rather than by pulling in the WebWorker lib, which would fight
 * with the DOM lib every other file here depends on.
 */
const host = globalThis as unknown as {
	onmessage: ((event: MessageEvent<MapWorkRequest>) => void) | null;
	postMessage(message: MapWorkMessage, transfer?: Transferable[]): void;
};

host.onmessage = (event) => {
	const request = event.data;

	// The track first: it is the point of the map, and it is the cheap part.
	host.postMessage({ kind: 'path', path: samplePath(request.pathStepSeconds) });

	for (const [step, final] of [
		[request.coarseStep, false],
		[request.fineStep, true]
	] as const) {
		const grid = computeObscurationGrid(
			request.lonMin,
			request.lonMax,
			request.latMin,
			request.latMax,
			step
		);
		// Handing over the buffer rather than copying it; nothing here reads the
		// grid again afterwards.
		host.postMessage({ kind: 'grid', grid, final }, [grid.values.buffer]);
	}
};
