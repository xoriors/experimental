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
		markerTapThresholdPx?: number;
		markerColor?: string;
		polylineColor?: string;
		height?: string;
	};

	let {
		markers = [],
		polyline,
		interactive = true,
		onPick,
		onMarkerTap,
		markerTapThresholdPx = 24,
		markerColor = '#38bdf8',
		polylineColor = '#38bdf8',
		height = '360px'
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
	});

	onDestroy(() => {
		drawn.forEach((m) => m.remove());
		map?.remove();
		map = null;
	});

	$effect(() => {
		void markers;
		void polyline;
		void markerColor;
		void polylineColor;
		renderMarkersAndLine();
	});

	function renderMarkersAndLine() {
		if (!map) return;
		drawn.forEach((m) => m.remove());
		drawn = [];

		for (const m of markers) {
			const marker = new maplibregl.Marker({ color: markerColor })
				.setLngLat([m.lon, m.lat])
				.addTo(map);
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
