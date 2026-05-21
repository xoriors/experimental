<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { decodeView, defaultState, encodeView, viewsEqual } from '$lib/url-state';
	import { setView, view } from '$lib/state.svelte';
	import ShareBar from '$lib/components/ShareBar.svelte';

	let { children } = $props();
	let initialized = $state(false);
	let lastSerialized = $state<string>('');

	function paramsFromLocation(): URLSearchParams {
		const hash = window.location.hash.startsWith('#')
			? window.location.hash.slice(1)
			: window.location.hash;
		if (hash) return new URLSearchParams(hash);
		return new URLSearchParams(window.location.search);
	}

	function resetAll(e?: Event) {
		e?.preventDefault();
		setView(defaultState());
		if (browser) {
			history.replaceState(history.state, '', window.location.pathname);
			lastSerialized = '';
		}
	}

	onMount(() => {
		const decoded = decodeView(paramsFromLocation());
		setView(decoded);
		lastSerialized = encodeView(decoded);
		initialized = true;

		if (window.location.search) {
			const target = lastSerialized
				? `${window.location.pathname}#${lastSerialized}`
				: window.location.pathname;
			history.replaceState(history.state, '', target);
		}

		const onHash = () => {
			const next = decodeView(paramsFromLocation());
			if (!viewsEqual(next, view)) {
				setView(next);
				lastSerialized = encodeView(next);
			}
		};
		window.addEventListener('hashchange', onHash);
		window.addEventListener('popstate', onHash);
		return () => {
			window.removeEventListener('hashchange', onHash);
			window.removeEventListener('popstate', onHash);
		};
	});

	$effect(() => {
		if (!initialized || !browser) return;
		const serialized = encodeView(view);
		if (serialized === lastSerialized) return;
		lastSerialized = serialized;
		const target = serialized
			? `${window.location.pathname}#${serialized}`
			: window.location.pathname;
		history.replaceState(history.state, '', target);
	});
</script>

<div class="container">
	<header>
		<h1>
			<a
				href="/"
				class="home-link"
				onclick={resetAll}
				title="Reset all selections and go home"
			>🌦️ Weather Voodoo</a>
		</h1>
		<ShareBar onReset={resetAll} />
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
	.home-link {
		color: inherit;
		text-decoration: none;
		cursor: pointer;
	}
	.home-link:hover {
		opacity: 0.85;
	}
</style>
