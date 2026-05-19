<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { decodeView, encodeView, viewsEqual } from '$lib/url-state';
	import { setView, view } from '$lib/state.svelte';
	import ShareBar from '$lib/components/ShareBar.svelte';

	let { children } = $props();
	let initialized = $state(false);
	let lastSerialized = $state<string>('');

	onMount(() => {
		const url = new URL(window.location.href);
		const decoded = decodeView(url.searchParams);
		setView(decoded);
		lastSerialized = encodeView(decoded);
		initialized = true;

		const sub = page.subscribe(($page) => {
			if (!$page.url) return;
			const next = decodeView($page.url.searchParams);
			if (!viewsEqual(next, view)) {
				setView(next);
				lastSerialized = encodeView(next);
			}
		});
		return sub;
	});

	$effect(() => {
		if (!initialized || !browser) return;
		const serialized = encodeView(view);
		if (serialized === lastSerialized) return;
		lastSerialized = serialized;
		const target = `/?${serialized}`;
		goto(target, { replaceState: true, keepFocus: true, noScroll: true });
	});
</script>

<div class="container">
	<header style="display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem;">
		<h1 style="margin: 0; font-size: 1.25rem;">🌦️ Weather Prediction</h1>
		<ShareBar />
	</header>
	{@render children?.()}
</div>
