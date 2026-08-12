<script lang="ts">
	/**
	 * Every candidate spot on one map, coloured by whether the Sun will clear the
	 * terrain there, with a ray from the selected spot showing exactly which way
	 * to look. Tiles come from OpenStreetMap, so there is no API key and nothing
	 * to configure — the Google Maps panel beside it covers the satellite view.
	 */
	import { onMount } from 'svelte';
	import type { ScoredSpot } from '$lib/eclipse/viewpoints';
	import type { ViewQuality } from '$lib/eclipse/horizon';

	interface Props {
		origin: ScoredSpot | null;
		spots: ScoredSpot[];
		selected: ScoredSpot | null;
		onselect: (spot: ScoredSpot) => void;
		height?: number;
	}

	let { origin, spots, selected, onselect, height = 420 }: Props = $props();

	const TILE = 256;
	const MAX_ZOOM = 17;
	const MIN_ZOOM = 6;

	const QUALITY_COLOUR: Record<ViewQuality, string> = {
		clear: '#4ade80',
		likely: '#a3d977',
		marginal: '#ffb545',
		blocked: '#ff6b5e'
	};

	let canvas: HTMLCanvasElement;
	let wrapper: HTMLDivElement;
	let width = $state(800);
	let zoom = $state(12);
	let centreLat = $state(47.6573);
	let centreLon = $state(23.5681);
	let ready = $state(false);

	const tiles = new Map<string, HTMLImageElement>();
	let dragging = false;
	let moved = false;
	let dragStart = { x: 0, y: 0, lat: 0, lon: 0 };

	/* --- Web Mercator ------------------------------------------------- */
	const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * Math.pow(2, z) * TILE;
	function latToY(lat: number, z: number): number {
		const rad = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
		return (
			((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z) * TILE
		);
	}
	const xToLon = (x: number, z: number) => (x / (Math.pow(2, z) * TILE)) * 360 - 180;
	function yToLat(y: number, z: number): number {
		const n = Math.PI - (2 * Math.PI * y) / (Math.pow(2, z) * TILE);
		return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
	}

	const all = $derived(origin ? [origin, ...spots] : spots);

	/** Frame the map on everything the search returned. */
	function fitToSpots() {
		if (!all.length) return;
		const lats = all.map((s) => s.spot.lat);
		const lons = all.map((s) => s.spot.lon);
		centreLat = (Math.min(...lats) + Math.max(...lats)) / 2;
		centreLon = (Math.min(...lons) + Math.max(...lons)) / 2;

		for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
			const xs = lons.map((l) => lonToX(l, z));
			const ys = lats.map((l) => latToY(l, z));
			const spanX = Math.max(...xs) - Math.min(...xs);
			const spanY = Math.max(...ys) - Math.min(...ys);
			if (spanX < width - 80 && spanY < height - 80) {
				zoom = z;
				return;
			}
		}
		zoom = MIN_ZOOM;
	}

	// Re-frame whenever a fresh set of results arrives.
	let lastSignature = '';
	$effect(() => {
		const signature = all.map((s) => s.spot.id).join('|');
		if (signature && signature !== lastSignature) {
			lastSignature = signature;
			fitToSpots();
		}
	});

	onMount(() => {
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) width = Math.max(280, Math.round(entry.contentRect.width));
		});
		observer.observe(wrapper);
		ready = true;
		return () => observer.disconnect();
	});

	function tileImage(z: number, x: number, y: number): HTMLImageElement | null {
		const max = Math.pow(2, z);
		if (y < 0 || y >= max) return null;
		const wrappedX = ((x % max) + max) % max;
		const key = `${z}/${wrappedX}/${y}`;
		const cached = tiles.get(key);
		if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;

		const image = new Image();
		image.crossOrigin = 'anonymous';
		image.decoding = 'async';
		image.src = `https://tile.openstreetmap.org/${z}/${wrappedX}/${y}.png`;
		image.onload = () => draw();
		image.onerror = () => tiles.delete(key);
		tiles.set(key, image);
		return null;
	}

	function draw() {
		if (!canvas) return;
		const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
		if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
		if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

		ctx.fillStyle = '#0d0f1a';
		ctx.fillRect(0, 0, width, height);

		const originX = lonToX(centreLon, zoom) - width / 2;
		const originY = latToY(centreLat, zoom) - height / 2;
		const toScreen = (lat: number, lon: number): [number, number] => [
			lonToX(lon, zoom) - originX,
			latToY(lat, zoom) - originY
		];

		// Tiles.
		const firstX = Math.floor(originX / TILE);
		const firstY = Math.floor(originY / TILE);
		const lastX = Math.floor((originX + width) / TILE);
		const lastY = Math.floor((originY + height) / TILE);
		ctx.save();
		// OSM's own style is bright; dim it so the markers carry the page.
		ctx.globalAlpha = 0.62;
		for (let x = firstX; x <= lastX; x++) {
			for (let y = firstY; y <= lastY; y++) {
				const image = tileImage(zoom, x, y);
				if (!image) continue;
				ctx.drawImage(image, x * TILE - originX, y * TILE - originY, TILE, TILE);
			}
		}
		ctx.restore();

		// The direction to look, drawn from the selected spot.
		if (selected) {
			const [sx, sy] = toScreen(selected.spot.lat, selected.spot.lon);
			const angle = ((selected.sunAzimuthDeg - 90) * Math.PI) / 180;
			const length = Math.max(width, height);
			ctx.save();
			ctx.strokeStyle = 'rgba(255,181,69,0.85)';
			ctx.lineWidth = 2;
			ctx.setLineDash([7, 5]);
			ctx.beginPath();
			ctx.moveTo(sx, sy);
			ctx.lineTo(sx + Math.cos(angle) * length, sy + Math.sin(angle) * length);
			ctx.stroke();
			ctx.restore();
		}

		// Markers, worst first so the good ones sit on top.
		const order = [...all].sort((a, b) => a.verdict.clearanceDeg - b.verdict.clearanceDeg);
		for (const item of order) {
			const [x, y] = toScreen(item.spot.lat, item.spot.lon);
			if (x < -30 || x > width + 30 || y < -30 || y > height + 30) continue;
			const isSelected = selected?.spot.id === item.spot.id;
			const isOrigin = item.spot.id === 'origin';
			const radius = isSelected ? 9 : 6.5;

			ctx.beginPath();
			ctx.arc(x, y, radius, 0, Math.PI * 2);
			ctx.fillStyle = QUALITY_COLOUR[item.verdict.quality];
			ctx.fill();
			ctx.lineWidth = isSelected ? 3 : 1.5;
			ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(6,7,13,0.85)';
			ctx.stroke();

			if (isOrigin) {
				ctx.beginPath();
				ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
				ctx.strokeStyle = 'rgba(255,255,255,0.6)';
				ctx.lineWidth = 1.5;
				ctx.stroke();
			}
		}
	}

	$effect(() => {
		// Touch the reactive inputs so the map redraws when any of them change.
		void [width, height, zoom, centreLat, centreLon, all, selected, ready];
		draw();
	});

	function pick(clientX: number, clientY: number) {
		const rect = canvas.getBoundingClientRect();
		const px = clientX - rect.left;
		const py = clientY - rect.top;
		const originX = lonToX(centreLon, zoom) - width / 2;
		const originY = latToY(centreLat, zoom) - height / 2;
		let best: ScoredSpot | null = null;
		let bestDistance = 22;
		for (const item of all) {
			const x = lonToX(item.spot.lon, zoom) - originX;
			const y = latToY(item.spot.lat, zoom) - originY;
			const d = Math.hypot(x - px, y - py);
			if (d < bestDistance) {
				bestDistance = d;
				best = item;
			}
		}
		if (best) onselect(best);
	}

	function onPointerDown(event: PointerEvent) {
		dragging = true;
		moved = false;
		(event.target as Element).setPointerCapture(event.pointerId);
		dragStart = { x: event.clientX, y: event.clientY, lat: centreLat, lon: centreLon };
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging) return;
		const dx = event.clientX - dragStart.x;
		const dy = event.clientY - dragStart.y;
		if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
		const originX = lonToX(dragStart.lon, zoom) - dx;
		const originY = latToY(dragStart.lat, zoom) - dy;
		centreLon = xToLon(originX, zoom);
		centreLat = yToLat(originY, zoom);
	}

	function onPointerUp(event: PointerEvent) {
		if (dragging && !moved) pick(event.clientX, event.clientY);
		dragging = false;
		(event.target as Element).releasePointerCapture?.(event.pointerId);
	}

	function zoomBy(delta: number, anchorX?: number, anchorY?: number) {
		const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta));
		if (next === zoom) return;
		if (anchorX === undefined || anchorY === undefined) {
			zoom = next;
			return;
		}
		// Keep whatever is under the cursor where it is.
		const originX = lonToX(centreLon, zoom) - width / 2;
		const originY = latToY(centreLat, zoom) - height / 2;
		const lon = xToLon(originX + anchorX, zoom);
		const lat = yToLat(originY + anchorY, zoom);
		zoom = next;
		const newOriginX = lonToX(lon, zoom) - anchorX;
		const newOriginY = latToY(lat, zoom) - anchorY;
		centreLon = xToLon(newOriginX + width / 2, zoom);
		centreLat = yToLat(newOriginY + height / 2, zoom);
	}

	function onWheel(event: WheelEvent) {
		event.preventDefault();
		const rect = canvas.getBoundingClientRect();
		zoomBy(event.deltaY < 0 ? 1 : -1, event.clientX - rect.left, event.clientY - rect.top);
	}
</script>

<div class="spot-map" bind:this={wrapper} style="height: {height}px">
	<canvas
		bind:this={canvas}
		style="width: {width}px; height: {height}px"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onwheel={onWheel}
		aria-label="Map of candidate viewing spots"
	></canvas>

	<div class="controls">
		<button onclick={() => zoomBy(1)} aria-label="Zoom in">+</button>
		<button onclick={() => zoomBy(-1)} aria-label="Zoom out">−</button>
		<button onclick={fitToSpots}>Fit</button>
	</div>

	<div class="legend">
		<span><i style="background:{QUALITY_COLOUR.clear}"></i> clear</span>
		<span><i style="background:{QUALITY_COLOUR.likely}"></i> probably</span>
		<span><i style="background:{QUALITY_COLOUR.marginal}"></i> marginal</span>
		<span><i style="background:{QUALITY_COLOUR.blocked}"></i> blocked</span>
		{#if selected}<span class="ray">— — direction of the Sun</span>{/if}
	</div>

	<a class="attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
		© OpenStreetMap
	</a>
</div>

<style>
	.spot-map {
		position: relative;
		width: 100%;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		background: #0d0f1a;
	}

	canvas {
		display: block;
		touch-action: none;
		cursor: grab;
	}

	canvas:active {
		cursor: grabbing;
	}

	.controls {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: flex;
		gap: 0.25rem;
	}

	.controls button {
		background: rgba(13, 15, 26, 0.9);
		padding: 0.2rem 0.55rem;
		font-size: 0.85rem;
	}

	.legend {
		position: absolute;
		left: 0.5rem;
		bottom: 0.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.7rem;
		background: rgba(6, 7, 13, 0.82);
		padding: 0.3rem 0.55rem;
		border-radius: 7px;
		font-size: 0.74rem;
		color: var(--text-dim);
	}

	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.legend i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		display: inline-block;
	}

	.legend .ray {
		color: var(--sun);
	}

	.attribution {
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		font-size: 0.7rem;
		color: var(--text-faint);
		background: rgba(6, 7, 13, 0.75);
		padding: 0.1rem 0.35rem;
		border-radius: 5px;
	}
</style>
