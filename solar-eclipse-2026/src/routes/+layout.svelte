<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();

	const links = [
		{ href: '/', label: 'Overview' },
		{ href: '/simulator', label: 'Simulator' },
		{ href: '/where', label: 'Where to watch' },
		{ href: '/safety', label: 'Eye safety' },
		{ href: '/guide', label: 'Guide' }
	];
</script>

<svelte:head>
	<meta name="theme-color" content="#06070d" />
</svelte:head>

<header class="site-header">
	<div class="shell">
		<a class="brand" href="/">
			<span class="brand-mark" aria-hidden="true"></span>
			<span>Eclipse 12 Aug 2026</span>
		</a>
		<nav class="site-nav" aria-label="Main">
			{#each links as link (link.href)}
				<a
					href={link.href}
					aria-current={page.url.pathname === link.href ? 'page' : undefined}>{link.label}</a
				>
			{/each}
		</nav>
	</div>
</header>

<main>
	{@render children()}
</main>

<footer class="site-footer">
	<div class="shell">
		<p>
			Eclipse geometry computed from the Besselian elements published by NASA/GSFC in the
			<a href="https://eclipse.gsfc.nasa.gov/SEsearch/SEdata.php?Ecl=20260812" rel="noreferrer">
				Five Millennium Canon of Solar Eclipses</a
			>
			(Espenak &amp; Meeus). Planetary positions use JPL's approximate Keplerian elements.
			Coastlines from Natural Earth.
		</p>
		<p>
			Times are computed, not copied. They are good to a few seconds, but near the edge of the path
			the limits are uncertain by a kilometre or two because of the Moon's rugged edge — if you are
			within a couple of kilometres of a limit, move further in.
		</p>
		<p>
			Part of the <a href="https://github.com/xoriors/experimental" rel="noreferrer">xorio experimental</a>
			sandbox. Not affiliated with NASA.
		</p>
	</div>
</footer>
