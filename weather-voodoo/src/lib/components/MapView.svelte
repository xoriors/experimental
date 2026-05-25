<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import type { LatLng } from '$lib/types';
	import type { RelativeWindClass } from '$lib/wind';

	export type WindChevron = {
		point: LatLng;
		/** Bearing of travel at this point (deg from N). Used for tooltip context. */
		headingDeg: number;
		/** Wind speed at the selected hour, knots. */
		windKn: number;
		/** Meteorological wind direction (from), deg from N. Used to orient the arrow. */
		windDirDeg: number;
		/** Wind angle relative to heading, in [-180, 180]. */
		relWindDeg: number;
		cls: RelativeWindClass;
		/** Localized class label for tooltip ("Head", "Tail-Cross", …). */
		classLabel: string;
	};

	type Props = {
		markers?: LatLng[];
		polyline?: LatLng[];
		interactive?: boolean;
		onPick?: (p: LatLng) => void;
		onMarkerTap?: (index: number) => void;
		onMarkerDrag?: (index: number, p: LatLng) => void;
		markerTapThresholdPx?: number;
		markerColor?: string;
		polylineColor?: string;
		draggableMarkers?: boolean;
		highlightIdx?: number | null;
		height?: string;
		/**
		 * Wind chevrons rendered along the route — one per sample point, sized
		 * for handlebar/glance-able use on mobile. Color = relative-wind class,
		 * arrow direction = absolute wind direction (where the wind is going).
		 */
		windChevrons?: WindChevron[];
		/** Show user's live GPS position as a pulsing blue dot. */
		showUserLocation?: boolean;
	};

	let {
		markers = [],
		polyline,
		interactive = true,
		onPick,
		onMarkerTap,
		onMarkerDrag,
		markerTapThresholdPx = 44,
		markerColor = '#38bdf8',
		polylineColor = '#38bdf8',
		draggableMarkers = false,
		highlightIdx = null,
		height = '440px',
		windChevrons,
		showUserLocation = false
	}: Props = $props();

	let el: HTMLDivElement | null = null;
	let map: MlMap | null = null;
	let drawn: Marker[] = [];
	let drawnChevrons: Marker[] = [];
	let userLocMarker: Marker | null = null;
	let geoWatchId: number | null = null;

	const STYLE = {
		version: 8 as const,
		sources: {
			osm: {
				type: 'raster' as const,
				tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
				tileSize: 256,
				attribution: '&copy; OpenStreetMap contributors'
			}
		},
		layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }]
	};

	onMount(() => {
		if (!el) return;
		map = new maplibregl.Map({
			container: el,
			style: STYLE,
			center: markers.length ? [markers[0].lon, markers[0].lat] : [98.85, 7.9],
			zoom: markers.length ? 9 : 4
		});

		if (interactive) {
			map.on('click', (e) => {
				if (!map) return;
				// If a marker tap handler is registered and the click is close to
				// an existing marker (in screen-pixel distance), prefer that.
				if (onMarkerTap && markers.length > 0) {
					const tapPt = map.project([e.lngLat.lng, e.lngLat.lat]);
					let bestIdx = -1;
					let bestDist = Infinity;
					for (let i = 0; i < markers.length; i++) {
						const mPt = map.project([markers[i].lon, markers[i].lat]);
						const dx = mPt.x - tapPt.x;
						const dy = mPt.y - tapPt.y;
						const d = Math.hypot(dx, dy);
						if (d < bestDist) {
							bestDist = d;
							bestIdx = i;
						}
					}
					if (bestIdx >= 0 && bestDist <= markerTapThresholdPx) {
						onMarkerTap(bestIdx);
						return;
					}
				}
				onPick?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
			});
		}

		renderMarkersAndLine();
		renderWindChevrons();
		startGeolocation();

		// Re-measure when the container itself resizes (e.g. fullscreen toggle,
		// orientation change). maplibre listens to window resize but not
		// container size changes.
		if (el && typeof ResizeObserver !== 'undefined') {
			resizeObs = new ResizeObserver(() => {
				if (map) map.resize();
			});
			resizeObs.observe(el);
		}
	});

	let resizeObs: ResizeObserver | null = null;

	onDestroy(() => {
		drawn.forEach((m) => m.remove());
		drawnChevrons.forEach((m) => m.remove());
		userLocMarker?.remove();
		if (geoWatchId !== null) navigator.geolocation.clearWatch(geoWatchId);
		resizeObs?.disconnect();
		resizeObs = null;
		map?.remove();
		map = null;
	});

	$effect(() => {
		void markers;
		void polyline;
		void markerColor;
		void polylineColor;
		void draggableMarkers;
		void highlightIdx;
		renderMarkersAndLine();
	});

	$effect(() => {
		void windChevrons;
		renderWindChevrons();
	});

	function buildUserDot(): HTMLElement {
		const dot = document.createElement('div');
		dot.className = 'user-loc-dot';
		dot.setAttribute('aria-label', 'Your location');
		dot.innerHTML = '<div class="user-loc-pulse"></div><div class="user-loc-core"></div>';
		return dot;
	}

	function startGeolocation() {
		if (!showUserLocation || !map || !('geolocation' in navigator)) return;
		geoWatchId = navigator.geolocation.watchPosition(
			(pos) => {
				if (!map) return;
				const lng = pos.coords.longitude;
				const lat = pos.coords.latitude;
				if (!userLocMarker) {
					userLocMarker = new maplibregl.Marker({ element: buildUserDot(), anchor: 'center' })
						.setLngLat([lng, lat])
						.addTo(map);
				} else {
					userLocMarker.setLngLat([lng, lat]);
				}
			},
			() => {},
			{ enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 }
		);
	}

	function renderMarkersAndLine() {
		if (!map) return;
		drawn.forEach((m) => m.remove());
		drawn = [];

		for (let i = 0; i < markers.length; i++) {
			const m = markers[i];
			const isHighlighted = highlightIdx === i;
			const marker = new maplibregl.Marker({
				color: isHighlighted ? '#facc15' : markerColor,
				draggable: draggableMarkers
			})
				.setLngLat([m.lon, m.lat])
				.addTo(map);
			if (isHighlighted) {
				const el = marker.getElement();
				el.classList.add('marker-highlighted');
				el.style.zIndex = '20';
			}
			if (draggableMarkers && onMarkerDrag) {
				const idx = i;
				marker.on('dragend', () => {
					const ll = marker.getLngLat();
					onMarkerDrag(idx, { lat: ll.lat, lon: ll.lng });
				});
			}
			drawn.push(marker);
		}

		// Camera fits don't require the style to be loaded — run them eagerly so
		// shared links open already framed on the route. Prefer polyline bounds
		// (a routed sea/trail polyline can detour well outside the markers' bbox)
		// and fall back to marker bounds when no route line is available yet.
		const fitTarget = polyline && polyline.length >= 2 ? polyline : markers;
		if (fitTarget.length >= 2) {
			const bounds = new maplibregl.LngLatBounds();
			fitTarget.forEach((p) => bounds.extend([p.lon, p.lat]));
			map.fitBounds(bounds, { padding: 60, maxZoom: 11, duration: 400 });
		} else if (markers.length === 1) {
			map.flyTo({ center: [markers[0].lon, markers[0].lat], zoom: 11, duration: 400 });
		}

		// The route source/layer needs the MapLibre style to be loaded first; on a
		// cold page load (shared link) this often isn't ready yet, so defer until
		// the 'load' event if necessary.
		if (map.isStyleLoaded()) {
			renderRouteLayer();
		} else {
			map.once('load', renderRouteLayer);
		}
	}

	function buildChevronElement(c: WindChevron): HTMLElement {
		// Where the wind is going in absolute compass terms (meteo windDir is
		// the direction the wind is FROM, so the arrow points to windDir + 180).
		const arrowRot = c.windDirDeg + 180;
		const speed = Math.round(c.windKn);
		const wrap = document.createElement('div');
		wrap.className = 'wind-chevron';
		wrap.dataset.cls = c.cls;
		const tooltipParts = [
			`${c.classLabel} · ${speed} kn`,
			`wind from ${Math.round(((c.windDirDeg % 360) + 360) % 360)}°`,
			`heading ${Math.round(((c.headingDeg % 360) + 360) % 360)}°`,
			`relative ${Math.round(c.relWindDeg)}°`
		];
		const tooltip = tooltipParts.join(' · ');
		wrap.setAttribute('title', tooltip);
		wrap.setAttribute('aria-label', tooltip);
		wrap.setAttribute('role', 'img');
		wrap.innerHTML = `
			<div class="wc-ring">
				<svg viewBox="0 0 24 24" style="transform: rotate(${arrowRot}deg)" aria-hidden="true">
					<path d="M12 3 L12 21 M5 10 L12 3 L19 10" fill="none" stroke="#fff"
						stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
			</div>
			<div class="wc-label">${speed}<span class="wc-unit">kn</span></div>
		`;
		return wrap;
	}

	function renderWindChevrons() {
		if (!map) return;
		drawnChevrons.forEach((m) => m.remove());
		drawnChevrons = [];
		if (!windChevrons || windChevrons.length === 0) return;
		for (const c of windChevrons) {
			const element = buildChevronElement(c);
			const marker = new maplibregl.Marker({ element, anchor: 'center' })
				.setLngLat([c.point.lon, c.point.lat])
				.addTo(map);
			drawnChevrons.push(marker);
		}
	}

	function renderRouteLayer() {
		if (!map) return;
		if (map.getLayer('route-line')) map.removeLayer('route-line');
		if (map.getSource('route-src')) map.removeSource('route-src');

		if (polyline && polyline.length >= 2) {
			map.addSource('route-src', {
				type: 'geojson',
				data: {
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'LineString',
						coordinates: polyline.map((p) => [p.lon, p.lat])
					}
				}
			});
			map.addLayer({
				id: 'route-line',
				type: 'line',
				source: 'route-src',
				paint: { 'line-color': polylineColor, 'line-width': 3, 'line-opacity': 0.85 }
			});
		}
	}
</script>

<div bind:this={el} class="map" style="height: {height}"></div>

<style>
	:global(.marker-highlighted) {
		filter: drop-shadow(0 0 6px rgba(250, 204, 21, 0.9));
		transform-origin: center bottom;
	}
	:global(.marker-highlighted svg) {
		transform: scale(1.3);
		transform-origin: center bottom;
	}

	/*
	 * Wind chevrons — sized for handlebar-mounted glance use. Dark backdrop
	 * survives bright sun and water/land tile transitions; the colored ring
	 * carries the head/tail/cross meaning while the white arrow stays readable
	 * against any background.
	 */
	:global(.wind-chevron) {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		pointer-events: auto;
		cursor: help;
		user-select: none;
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.55));
		transition: transform 160ms ease;
	}
	:global(.wind-chevron:hover) {
		transform: scale(1.08);
		z-index: 30;
	}
	:global(.wind-chevron .wc-ring) {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: rgba(15, 23, 42, 0.88);
		border: 4px solid var(--wc-color, #cbd5e1);
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
	}
	:global(.wind-chevron .wc-ring svg) {
		width: 28px;
		height: 28px;
		transition: transform 220ms ease;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
	}
	:global(.wind-chevron .wc-label) {
		font-size: 12px;
		font-weight: 800;
		color: #fff;
		line-height: 1;
		padding: 2px 6px;
		background: rgba(15, 23, 42, 0.9);
		border-radius: 6px;
		border: 1.5px solid var(--wc-color, #cbd5e1);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.2px;
		white-space: nowrap;
	}
	:global(.wind-chevron .wc-unit) {
		font-size: 9px;
		font-weight: 600;
		opacity: 0.8;
		margin-left: 1px;
	}
	:global(.wind-chevron[data-cls='head']) {
		--wc-color: #f87171;
	}
	:global(.wind-chevron[data-cls='head-cross']) {
		--wc-color: #fb923c;
	}
	:global(.wind-chevron[data-cls='cross']) {
		--wc-color: #94a3b8;
	}
	:global(.wind-chevron[data-cls='tail-cross']) {
		--wc-color: #a3e635;
	}
	:global(.wind-chevron[data-cls='tail']) {
		--wc-color: #22c55e;
	}
	/* Live GPS blue dot — pulsing ring + solid core */
	:global(.user-loc-dot) {
		position: relative;
		width: 20px;
		height: 20px;
		z-index: 15;
	}
	:global(.user-loc-core) {
		position: absolute;
		top: 4px;
		left: 4px;
		width: 12px;
		height: 12px;
		background: #3b82f6;
		border: 2.5px solid #fff;
		border-radius: 50%;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
	}
	:global(.user-loc-pulse) {
		position: absolute;
		inset: -6px;
		border-radius: 50%;
		background: rgba(59, 130, 246, 0.25);
		animation: loc-pulse 2s ease-out infinite;
	}
	@keyframes loc-pulse {
		0% { transform: scale(0.6); opacity: 1; }
		100% { transform: scale(2.2); opacity: 0; }
	}
	@media (max-width: 720px) {
		:global(.wind-chevron .wc-ring) {
			width: 42px;
			height: 42px;
			border-width: 3px;
		}
		:global(.wind-chevron .wc-ring svg) {
			width: 24px;
			height: 24px;
		}
		:global(.wind-chevron .wc-label) {
			font-size: 11px;
			padding: 1.5px 5px;
		}
	}
</style>
