<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import type { LatLng } from '$lib/types';

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
		height = '440px'
	}: Props = $props();

	let el: HTMLDivElement | null = null;
	let map: MlMap | null = null;
	let drawn: Marker[] = [];

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

		if (map.getLayer('route-line')) map.removeLayer('route-line');
		if (map.getSource('route-src')) map.removeSource('route-src');

		if (polyline && polyline.length >= 2 && map.isStyleLoaded()) {
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

		if (markers.length >= 2 && map.isStyleLoaded()) {
			const bounds = new maplibregl.LngLatBounds();
			markers.forEach((m) => bounds.extend([m.lon, m.lat]));
			map.fitBounds(bounds, { padding: 60, maxZoom: 11, duration: 400 });
		} else if (markers.length === 1) {
			map.flyTo({ center: [markers[0].lon, markers[0].lat], zoom: 11, duration: 400 });
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
</style>
