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
	<header>
		<h1>🌦️ Weather Voodoo</h1>
		<ShareBar />
	</header>
	{@render children?.()}
</div>

<style>
	header {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	header h1 {
		margin: 0;
		font-size: 1.25rem;
		flex: 1 1 auto;
		min-width: 0;
	}
</style>
