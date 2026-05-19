<script lang="ts">
	import { env as pubEnv } from '$env/dynamic/public';
	import { onMount } from 'svelte';
	import { loadGoogleMaps } from '$lib/client/googleMaps';
	import type { LabeledPoint } from '$lib/types';

	type Props = {
		placeholder?: string;
		initial?: string;
		onSelect: (p: LabeledPoint) => void;
	};

	let { placeholder = 'Search a place…', initial = '', onSelect }: Props = $props();

	let q = $state(initial ?? '');
	let input = $state<HTMLInputElement | null>(null);
	let results = $state<{ name: string; lat: number; lon: number; label: string }[]>([]);
	let showResults = $state(false);
	let googleReady = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	const apiKey = pubEnv.PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

	onMount(() => {
		if (!apiKey || !input) return;
		loadGoogleMaps(apiKey)
			.then((google) => {
				if (!input) return;
				const ac = new google.maps.places.Autocomplete(input, {
					fields: ['geometry', 'name', 'formatted_address']
				});
				ac.addListener('place_changed', () => {
					const place = ac.getPlace();
					if (!place.geometry?.location) return;
					const lat = place.geometry.location.lat();
					const lon = place.geometry.location.lng();
					const label = place.formatted_address ?? place.name ?? `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
					q = label;
					showResults = false;
					onSelect({ lat, lon, label });
				});
				googleReady = true;
			})
			.catch(() => {
				googleReady = false;
			});
	});

	async function fallbackSearch() {
		if (timer) clearTimeout(timer);
		timer = setTimeout(async () => {
			const term = q.trim();
			if (term.length < 2) {
				results = [];
				showResults = false;
				return;
			}
			const res = await fetch(`/api/geocode?q=${encodeURIComponent(term)}`);
			if (!res.ok) return;
			const data = (await res.json()) as {
				results: { name: string; lat: number; lon: number; country?: string; admin1?: string }[];
			};
			results = data.results.map((r) => ({
				name: r.name,
				lat: r.lat,
				lon: r.lon,
				label: [r.name, r.admin1, r.country].filter(Boolean).join(', ')
			}));
			showResults = results.length > 0;
		}, 250);
	}

	function pickResult(r: { lat: number; lon: number; label: string }) {
		q = r.label;
		showResults = false;
		onSelect({ lat: r.lat, lon: r.lon, label: r.label });
	}

	function onInput() {
		if (!googleReady) fallbackSearch();
	}
</script>

<div style="position: relative; flex: 1; min-width: 200px;">
	<input
		bind:this={input}
		bind:value={q}
		oninput={onInput}
		{placeholder}
		class="input"
		type="search"
		autocomplete="off"
		style="width: 100%;"
	/>
	{#if showResults && !googleReady}
		<div class="results-list">
			{#each results as r}
				<button onclick={() => pickResult(r)}>{r.label}</button>
			{/each}
		</div>
	{/if}
</div>
