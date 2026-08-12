/**
 * The corona texture, computed away from the page.
 *
 * Fifty million exponentials for one image that never changes. Done inline it
 * froze the simulator for about three seconds on arrival — long enough to look
 * broken — and it was being done before anything had been drawn. Here it costs
 * the page nothing, and the sky renders without it in the meantime: the renderer
 * takes a null corona quite happily, and outside totality there is nothing to
 * show anyway.
 */

import { coronaPixels } from './corona';

export interface CoronaWorkRequest {
	size: number;
	extent: number;
	seed: number;
}

export interface CoronaWorkMessage {
	pixels: Uint8ClampedArray<ArrayBuffer>;
	size: number;
	extent: number;
}

/** Typed by hand rather than by pulling in the WebWorker lib. */
const host = globalThis as unknown as {
	onmessage: ((event: MessageEvent<CoronaWorkRequest>) => void) | null;
	postMessage(message: CoronaWorkMessage, transfer?: Transferable[]): void;
};

host.onmessage = (event) => {
	const { size, extent, seed } = event.data;
	const pixels = coronaPixels(size, extent, seed);
	host.postMessage({ pixels, size, extent }, [pixels.buffer]);
};
