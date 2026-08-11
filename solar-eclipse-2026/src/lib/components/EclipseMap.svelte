<script lang="ts">
	import { onMount } from 'svelte';
	import { feature } from 'topojson-client';
	import type { Observer } from '$lib/eclipse/besselian';
	import {
		computeObscurationGrid,
		samplePath,
		sampleGrid,
		umbraAt,
		type LngLat,
		type ObscurationGrid,
		type PathSample
	} from '$lib/map/eclipse-path';

	interface Props {
		observer: Observer;
		/** Current simulation time in element hours, or null to hide the umbra. */
		t?: number | null;
		onpick?: (lat: number, lon: number) => void;
		markers?: Array<{ lat: number; lon: number; name: string }>;
		height?: number;
	}

	let { observer, t = null, onpick, markers = [], height = 460 }: Props = $props();

	let canvas: HTMLCanvasElement;
	let wrapper: HTMLDivElement;
	let width = $state(900);

	// View window in degrees. Defaults to the whole track.
	let centreLon = $state(-14);
	let centreLat = $state(52);
	let degreesAcross = $state(96);

	let land = $state<Array<Array<LngLat>>>([]);
	let path = $state<PathSample[]>([]);
	let grid = $state<ObscurationGrid | null>(null);
	let loading = $state(true);

	let dragging = false;
	let moved = false;
	let dragStart = { x: 0, y: 0, lon: 0, lat: 0 };

	onMount(() => {
		const resize = new ResizeObserver((entries) => {
			for (const entry of entries) width = Math.max(320, Math.round(entry.contentRect.width));
		});
		resize.observe(wrapper);

		// The path and the obscuration grid are pure computation; the coastlines
		// are a chunky download, so both are deferred off the critical path.
		path = samplePath(30);
		grid = computeObscurationGrid(-80, 55, 18, 86, 0.75);

		import('world-atlas/countries-50m.json')
			.then((topology) => {
				const collection = feature(topology.default as never, (topology.default as never as { objects: { countries: unknown } }).objects.countries as never) as unknown as {
					features: Array<{ geometry: { type: string; coordinates: number[][][] | number[][][][] } }>;
				};
				const rings: Array<Array<LngLat>> = [];
				for (const f of collection.features) {
					if (!f.geometry) continue;
					if (f.geometry.type === 'Polygon') {
						for (const ring of f.geometry.coordinates as number[][][]) rings.push(ring as LngLat[]);
					} else if (f.geometry.type === 'MultiPolygon') {
						for (const polygon of f.geometry.coordinates as number[][][][]) {
							for (const ring of polygon) rings.push(ring as LngLat[]);
						}
					}
				}
				land = rings;
				loading = false;
			})
			.catch(() => {
				loading = false;
			});

		return () => resize.disconnect();
	});

	const mapHeight = $derived(height);
	const scale = $derived(width / degreesAcross);

	/** Shortest signed longitude difference, in degrees. */
	function wrapTo180(delta: number): number {
		return ((((delta + 180) % 360) + 360) % 360) - 180;
	}

	function toScreen(lon: number, lat: number): [number, number] {
		let dLon = lon - centreLon;
		while (dLon > 180) dLon -= 360;
		while (dLon < -180) dLon += 360;
		return [width / 2 + dLon * scale, mapHeight / 2 - (lat - centreLat) * scale];
	}

	function toGeo(x: number, y: number): [number, number] {
		return [
			centreLon + (x - width / 2) / scale,
			centreLat - (y - mapHeight / 2) / scale
		];
	}

	function drawRings(
		ctx: CanvasRenderingContext2D,
		rings: Array<Array<LngLat>>,
		fill: string,
		stroke: string
	) {
		ctx.beginPath();
		for (const ring of rings) {
			if (ring.length < 2) continue;

			// Unwrap longitudes so a country that straddles the antimeridian —
			// Russia, Fiji, Antarctica — stays a compact polygon instead of being
			// smeared right across the map as a band of phantom land. Note that
			// these points are projected without the usual wrap: putting them
			// through toScreen would immediately undo the unwrapping.
			const points: Array<[number, number]> = [];
			let previousLon = centreLon + wrapTo180(ring[0][0] - centreLon);
			let minX = Infinity;
			let maxX = -Infinity;
			let minY = Infinity;
			let maxY = -Infinity;

			for (const [rawLon, lat] of ring) {
				const lon = previousLon + wrapTo180(rawLon - previousLon);
				previousLon = lon;
				const x = width / 2 + (lon - centreLon) * scale;
				const y = mapHeight / 2 - (lat - centreLat) * scale;
				points.push([x, y]);
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}

			// Cheap cull: skip rings whose bounding box misses the canvas entirely.
			if (maxX < -40 || minX > width + 40 || maxY < -40 || minY > mapHeight + 40) continue;

			points.forEach(([x, y], index) => {
				if (index === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			});
			ctx.closePath();
		}
		ctx.fillStyle = fill;
		// Non-zero, not even-odd: the path holds thousands of separate country
		// rings, and even-odd makes disjoint landmasses cancel one another out,
		// painting phantom continents across the open ocean.
		ctx.fill('nonzero');
		ctx.strokeStyle = stroke;
		ctx.lineWidth = 0.6;
		ctx.stroke();
	}

	$effect(() => {
		if (!canvas) return;
		const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(mapHeight * ratio);
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

		ctx.fillStyle = '#080a12';
		ctx.fillRect(0, 0, width, mapHeight);

		// Shade how deep the partial eclipse gets, so the map is useful to
		// everyone in Europe rather than only to people inside the narrow band.
		if (grid) {
			const step = 3;
			for (let y = 0; y < mapHeight; y += step) {
				for (let x = 0; x < width; x += step) {
					const [lon, lat] = toGeo(x + step / 2, y + step / 2);
					if (lat > 90 || lat < -90) continue;
					const value = sampleGrid(grid, lon, lat);
					if (value < 0.05) continue;
					const alpha = 0.06 + 0.42 * Math.pow(value, 2.4);
					ctx.fillStyle = `rgba(124, 92, 255, ${alpha})`;
					ctx.fillRect(x, y, step, step);
				}
			}
		}

		// Graticule.
		ctx.strokeStyle = 'rgba(120,130,160,0.14)';
		ctx.lineWidth = 0.5;
		ctx.beginPath();
		for (let lon = -180; lon <= 180; lon += 10) {
			const [x] = toScreen(lon, centreLat);
			if (x < -10 || x > width + 10) continue;
			ctx.moveTo(x, 0);
			ctx.lineTo(x, mapHeight);
		}
		for (let lat = -80; lat <= 80; lat += 10) {
			const [, y] = toScreen(centreLon, lat);
			if (y < -10 || y > mapHeight + 10) continue;
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
		}
		ctx.stroke();

		if (land.length) {
			drawRings(ctx, land, 'rgba(30,36,52,0.92)', 'rgba(120,134,168,0.55)');
		}

		// Swath of totality, drawn as one quad per time step rather than as a
		// single ring: near the pole the track doubles back and the limits swap
		// sides, which turns a single polygon into a self-intersecting mess.
		if (path.length > 1) {
			ctx.fillStyle = 'rgba(124,92,255,0.3)';
			for (let i = 0; i < path.length - 1; i++) {
				const a = path[i];
				const b = path[i + 1];
				const jump = Math.abs(a.centre.lon - b.centre.lon);
				if (jump > 60) continue; // crossed the antimeridian
				ctx.beginPath();
				const quad: LngLat[] = [a.north, b.north, b.south, a.south];
				quad.forEach((point, index) => {
					const [x, y] = toScreen(point[0], point[1]);
					if (index === 0) ctx.moveTo(x, y);
					else ctx.lineTo(x, y);
				});
				ctx.closePath();
				ctx.fill();
			}

			// The two limits as lines, which read more clearly than a filled edge.
			ctx.strokeStyle = 'rgba(167,142,255,0.9)';
			ctx.lineWidth = 1.2;
			for (const side of ['north', 'south'] as const) {
				ctx.beginPath();
				let pen = false;
				for (let i = 0; i < path.length; i++) {
					const point = path[i][side];
					if (i > 0 && Math.abs(path[i].centre.lon - path[i - 1].centre.lon) > 60) pen = false;
					const [x, y] = toScreen(point[0], point[1]);
					if (!pen) {
						ctx.moveTo(x, y);
						pen = true;
					} else ctx.lineTo(x, y);
				}
				ctx.stroke();
			}
		}

		// Centre line.
		if (path.length) {
			ctx.beginPath();
			path.forEach((sample, index) => {
				const [x, y] = toScreen(sample.centre.lon, sample.centre.lat);
				if (index === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			});
			ctx.strokeStyle = 'rgba(226,220,255,0.85)';
			ctx.lineWidth = 1;
			ctx.setLineDash([5, 4]);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// The umbra where it is right now.
		if (t !== null) {
			const ring = umbraAt(t);
			if (ring) {
				ctx.beginPath();
				ring.forEach(([lon, lat], index) => {
					const [x, y] = toScreen(lon, lat);
					if (index === 0) ctx.moveTo(x, y);
					else ctx.lineTo(x, y);
				});
				ctx.closePath();
				ctx.fillStyle = 'rgba(10,6,26,0.72)';
				ctx.fill();
				ctx.strokeStyle = '#ffd489';
				ctx.lineWidth = 1.6;
				ctx.stroke();
			}
		}

		// Markers, labelled once there is room for the text.
		const labelled = degreesAcross < 40;
		ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
		for (const marker of markers) {
			const [x, y] = toScreen(marker.lon, marker.lat);
			if (x < -20 || x > width + 20 || y < -20 || y > mapHeight + 20) continue;
			ctx.fillStyle = 'rgba(232,234,242,0.8)';
			ctx.beginPath();
			ctx.arc(x, y, 2.4, 0, Math.PI * 2);
			ctx.fill();
			if (labelled) {
				ctx.fillStyle = 'rgba(232,234,242,0.7)';
				ctx.fillText(marker.name, x + 5, y - 4);
			}
		}

		// The selected observer.
		const [ox, oy] = toScreen(observer.lon, observer.lat);
		ctx.strokeStyle = '#ffb545';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(ox, oy, 7, 0, Math.PI * 2);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(ox - 12, oy);
		ctx.lineTo(ox - 3, oy);
		ctx.moveTo(ox + 3, oy);
		ctx.lineTo(ox + 12, oy);
		ctx.moveTo(ox, oy - 12);
		ctx.lineTo(ox, oy - 3);
		ctx.moveTo(ox, oy + 3);
		ctx.lineTo(ox, oy + 12);
		ctx.stroke();
	});

	function onPointerDown(event: PointerEvent) {
		dragging = true;
		moved = false;
		(event.target as Element).setPointerCapture(event.pointerId);
		dragStart = { x: event.clientX, y: event.clientY, lon: centreLon, lat: centreLat };
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging) return;
		const dx = event.clientX - dragStart.x;
		const dy = event.clientY - dragStart.y;
		if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
		centreLon = dragStart.lon - dx / scale;
		centreLat = Math.max(-85, Math.min(89, dragStart.lat + dy / scale));
	}

	function onPointerUp(event: PointerEvent) {
		if (dragging && !moved && onpick) {
			const rect = canvas.getBoundingClientRect();
			const [lon, lat] = toGeo(event.clientX - rect.left, event.clientY - rect.top);
			onpick(lat, ((lon + 540) % 360) - 180);
		}
		dragging = false;
		(event.target as Element).releasePointerCapture?.(event.pointerId);
	}

	/** Zoom about a screen point so the geography under the cursor stays put. */
	function zoomAbout(factor: number, screenX: number, screenY: number) {
		const [lonBefore, latBefore] = toGeo(screenX, screenY);
		degreesAcross = Math.max(0.35, Math.min(200, degreesAcross * factor));
		const [lonAfter, latAfter] = toGeo(screenX, screenY);
		centreLon += lonBefore - lonAfter;
		centreLat = Math.max(-85, Math.min(89, centreLat + latBefore - latAfter));
	}

	function onWheel(event: WheelEvent) {
		event.preventDefault();
		const rect = canvas.getBoundingClientRect();
		zoomAbout(
			Math.exp(event.deltaY * 0.0015),
			event.clientX - rect.left,
			event.clientY - rect.top
		);
	}

	function zoom(factor: number) {
		zoomAbout(factor, width / 2, mapHeight / 2);
	}

	export function focusOn(lat: number, lon: number, across = 14) {
		centreLat = lat;
		centreLon = lon;
		degreesAcross = across;
	}

	function resetView() {
		centreLon = -14;
		centreLat = 52;
		degreesAcross = 96;
	}
</script>

<div class="map" bind:this={wrapper} style="height: {mapHeight}px">
	<canvas
		bind:this={canvas}
		style="width: {width}px; height: {mapHeight}px"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onwheel={onWheel}
		aria-label="Map of the path of totality"
	></canvas>

	<div class="controls">
		<button onclick={() => zoom(0.7)} aria-label="Zoom in">+</button>
		<button onclick={() => zoom(1.4)} aria-label="Zoom out">−</button>
		<button onclick={resetView}>Reset</button>
	</div>

	{#if loading}
		<div class="loading">Loading coastlines…</div>
	{/if}

	<div class="legend">
		<span><i class="swatch total"></i> totality</span>
		<span><i class="swatch partial"></i> partial (deeper = more covered)</span>
		<span><i class="swatch umbra"></i> shadow now</span>
	</div>
</div>

<style>
	.map {
		position: relative;
		width: 100%;
		border-radius: var(--radius);
		overflow: hidden;
		border: 1px solid var(--border);
		background: #080a12;
	}

	canvas {
		display: block;
		touch-action: none;
		cursor: crosshair;
	}

	.controls {
		position: absolute;
		top: 0.6rem;
		right: 0.6rem;
		display: flex;
		gap: 0.3rem;
	}

	.controls button {
		background: rgba(13, 15, 26, 0.9);
		padding: 0.25rem 0.6rem;
		font-size: 0.85rem;
	}

	.loading {
		position: absolute;
		top: 0.6rem;
		left: 0.6rem;
		font-size: 0.8rem;
		color: var(--text-faint);
		background: rgba(13, 15, 26, 0.9);
		padding: 0.2rem 0.5rem;
		border-radius: 6px;
	}

	.legend {
		position: absolute;
		left: 0.6rem;
		bottom: 0.6rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.76rem;
		color: var(--text-dim);
		background: rgba(8, 10, 18, 0.82);
		padding: 0.3rem 0.6rem;
		border-radius: 7px;
	}

	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.swatch {
		width: 11px;
		height: 11px;
		border-radius: 3px;
		display: inline-block;
	}

	.swatch.total {
		background: rgba(124, 92, 255, 0.65);
		border: 1px solid rgba(167, 142, 255, 0.9);
	}

	.swatch.partial {
		background: rgba(124, 92, 255, 0.22);
	}

	.swatch.umbra {
		background: rgba(10, 6, 26, 0.8);
		border: 1px solid #ffd489;
	}
</style>
