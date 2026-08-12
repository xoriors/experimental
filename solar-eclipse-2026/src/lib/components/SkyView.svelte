<script lang="ts">
	import { onMount } from 'svelte';
	import type { Observer } from '$lib/eclipse/besselian';
	import { renderScene, type Scene } from '$lib/sim/render';
	import { coronaFromPixels, renderCorona, type CoronaImage } from '$lib/sim/corona';
	import type { CoronaWorkMessage, CoronaWorkRequest } from '$lib/sim/corona.worker';

	interface Props {
		observer: Observer;
		time: Date;
		t: number;
		fieldOfView?: number;
		showLandscape?: boolean;
		showLabels?: boolean;
		applyRefraction?: boolean;
	}

	let {
		observer,
		time,
		t,
		fieldOfView = 40,
		showLandscape = true,
		showLabels = true,
		applyRefraction = true
	}: Props = $props();

	let canvas: HTMLCanvasElement;
	let wrapper: HTMLDivElement;
	let corona = $state<CoronaImage | null>(null);
	let width = $state(800);
	let height = $state(480);
	let panAltitude = $state(0);
	let panAzimuth = $state(0);
	let dragging = false;
	let dragStart = { x: 0, y: 0, alt: 0, az: 0 };

	onMount(() => {
		// Built once, because it never changes — but off this thread, because it is
		// three seconds of arithmetic and doing it here meant the page arrived
		// frozen. Until it lands the sky draws without it, which is exactly right
		// outside totality and no worse than a blank page inside it.
		let worker: Worker | undefined;
		try {
			worker = new Worker(new URL('../sim/corona.worker.ts', import.meta.url), {
				type: 'module'
			});
			worker.onmessage = (event: MessageEvent<CoronaWorkMessage>) => {
				const { pixels, size, extent } = event.data;
				corona = coronaFromPixels(pixels, size, extent);
				worker?.terminate();
				worker = undefined;
			};
			worker.onerror = () => {
				worker?.terminate();
				worker = undefined;
				if (!corona) corona = renderCorona(768, 4);
			};
			worker.postMessage({ size: 768, extent: 4, seed: 20260812 } satisfies CoronaWorkRequest);
		} catch {
			corona = renderCorona(768, 4);
		}

		const observerResize = new ResizeObserver((entries) => {
			for (const entry of entries) {
				width = Math.max(320, Math.round(entry.contentRect.width));
				height = Math.max(240, Math.round(entry.contentRect.height));
			}
		});
		observerResize.observe(wrapper);
		return () => {
			observerResize.disconnect();
			worker?.terminate();
		};
	});

	$effect(() => {
		if (!canvas) return;
		const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

		const scene: Scene = {
			observer,
			time,
			t,
			camera: { fieldOfView, panAltitude, panAzimuth },
			showLandscape,
			showLabels,
			applyRefraction
		};
		renderScene(ctx, width, height, scene, corona);
	});

	function onPointerDown(event: PointerEvent) {
		dragging = true;
		(event.target as Element).setPointerCapture(event.pointerId);
		dragStart = { x: event.clientX, y: event.clientY, alt: panAltitude, az: panAzimuth };
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging) return;
		const degreesPerPixel = fieldOfView / width;
		panAzimuth = dragStart.az - (event.clientX - dragStart.x) * degreesPerPixel;
		panAltitude = dragStart.alt + (event.clientY - dragStart.y) * degreesPerPixel;
	}

	function onPointerUp(event: PointerEvent) {
		dragging = false;
		(event.target as Element).releasePointerCapture?.(event.pointerId);
	}

	export function recentre() {
		panAltitude = 0;
		panAzimuth = 0;
	}
</script>

<div class="sky" bind:this={wrapper}>
	<canvas
		bind:this={canvas}
		style="width: {width}px; height: {height}px"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		aria-label="Simulated view of the sky during the eclipse"
	></canvas>
	{#if panAltitude !== 0 || panAzimuth !== 0}
		<button class="recentre" onclick={recentre}>Recentre on the Sun</button>
	{/if}
</div>

<style>
	.sky {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 320px;
		overflow: hidden;
		border-radius: var(--radius);
		background: #06070d;
	}

	canvas {
		display: block;
		touch-action: none;
		cursor: grab;
	}

	canvas:active {
		cursor: grabbing;
	}

	.recentre {
		position: absolute;
		left: 0.75rem;
		bottom: 0.75rem;
		font-size: 0.82rem;
		padding: 0.3rem 0.6rem;
		background: rgba(13, 15, 26, 0.85);
	}
</style>
