<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { decodeView, defaultState, encodeView, viewsEqual } from '$lib/url-state';
	import { setView, view } from '$lib/state.svelte';
	import { loadPlaces } from '$lib/client/recentPlaces.svelte';
	import ShareBar from '$lib/components/ShareBar.svelte';
	import IntroModal from '$lib/components/IntroModal.svelte';

	let { children } = $props();
	let initialized = $state(false);
	let lastSerialized = $state<string>('');
	let showIntro = $state(false);

	const INTRO_KEY = 'wv.introSeen.v1';

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

	function openIntro(e?: Event) {
		e?.preventDefault();
		showIntro = true;
	}

	function closeIntro() {
		showIntro = false;
		if (browser) {
			try {
				localStorage.setItem(INTRO_KEY, '1');
			} catch {
				// quota / private mode
			}
		}
	}

	onMount(() => {
		loadPlaces();
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

		// First-visit intro: only on the main app page, never on /help, never if there's
		// a hash with state (likely a shared link).
		const onMainPage = window.location.pathname === '/';
		const hasHash = !!window.location.hash.replace(/^#/, '');
		const alreadySeen = (() => {
			try {
				return localStorage.getItem(INTRO_KEY) === '1';
			} catch {
				return true;
			}
		})();
		if (onMainPage && !hasHash && !alreadySeen) {
			showIntro = true;
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
		if (window.location.pathname !== '/') return;
		const serialized = encodeView(view);
		if (serialized === lastSerialized) return;
		lastSerialized = serialized;
		const target = serialized
			? `${window.location.pathname}#${serialized}`
			: window.location.pathname;
		history.replaceState(history.state, '', target);
	});
</script>

<div class="container" class:mode-sea={view.tripMode === 'sea'} class:mode-land={view.tripMode === 'land'}>
	<header>
		<h1>
			<a
				href="/"
				class="home-link"
				onclick={resetAll}
				title="Reset all selections and go home"
			>🌦️ Weather Voodoo</a>
		</h1>
		<a class="help-link" href="/help" title="What this app does and how to use it">? Help</a>
		<ShareBar onReset={resetAll} />
	</header>
	{@render children?.()}
</div>

{#if showIntro}
	<IntroModal onClose={closeIntro} />
{/if}

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
	.help-link {
		color: var(--fg-dim);
		font-size: 0.9em;
		text-decoration: none;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.help-link:hover {
		color: var(--fg);
		background: var(--bg-elev, rgba(255, 255, 255, 0.05));
	}
</style>
