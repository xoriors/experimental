<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ECLIPSE_FACTS,
		GREATEST_ECLIPSE,
		PARTIAL_FIRST_CONTACT,
		PARTIAL_LAST_CONTACT,
		UMBRA_FIRST_CONTACT,
		UMBRA_LAST_CONTACT,
		shadowTimeline
	} from '$lib/eclipse/facts';
	import { countdownParts, formatDuration, formatUtc } from '$lib/format';

	const timeline = shadowTimeline();

	let now = $state(new Date());
	onMount(() => {
		const timer = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(timer);
	});

	const countdown = $derived(countdownParts(GREATEST_ECLIPSE.getTime() - now.getTime()));
	const inProgress = $derived(
		now >= PARTIAL_FIRST_CONTACT && now <= PARTIAL_LAST_CONTACT
	);
	const finished = $derived(now > PARTIAL_LAST_CONTACT);
</script>

<svelte:head>
	<title>Total solar eclipse, 12 August 2026 — path, times and a live simulator</title>
	<meta
		name="description"
		content="Everything about the total solar eclipse of 12 August 2026 over Greenland, Iceland and northern Spain: computed local times for any location, an interactive map of the path, eye-safety guidance and a physically accurate simulator."
	/>
</svelte:head>

<section class="hero">
	<div class="shell">
		<p class="kicker">Wednesday 12 August 2026 · Greenland · Iceland · Spain</p>
		<h1>The first total solar eclipse over mainland Europe since 1999.</h1>
		<p class="lede">
			For about two minutes the Moon will cover the Sun completely along a band roughly 290 km wide,
			running from the Arctic across Iceland and down into northern Spain — where it happens with the
			Sun almost on the horizon, minutes before sunset. Everywhere else in Europe, north Africa and
			eastern North America gets a partial eclipse.
		</p>

		<div class="countdown card">
			{#if finished}
				<p class="countdown-title">The eclipse is over.</p>
				<p class="countdown-note">
					You can still replay the whole thing minute by minute in the simulator.
				</p>
			{:else if inProgress}
				<p class="countdown-title live">The eclipse is happening now.</p>
				<p class="countdown-note">
					Greatest eclipse at {formatUtc(GREATEST_ECLIPSE)} UTC.
					<strong>Never look at the partially eclipsed Sun without a certified filter.</strong>
				</p>
			{:else}
				<p class="countdown-title">Until greatest eclipse</p>
				<div class="clock" aria-live="off">
					<span><b>{countdown.days}</b><i>days</i></span>
					<span><b>{String(countdown.hours).padStart(2, '0')}</b><i>hours</i></span>
					<span><b>{String(countdown.minutes).padStart(2, '0')}</b><i>min</i></span>
					<span><b>{String(countdown.seconds).padStart(2, '0')}</b><i>sec</i></span>
				</div>
				<p class="countdown-note">
					{formatUtc(GREATEST_ECLIPSE)} UTC on 12 August 2026
				</p>
			{/if}
		</div>

		<div class="actions">
			<a class="button-link" href="/simulator">Open the simulator</a>
			<a class="button-link ghost" href="/where">Find your local times</a>
			<a class="button-link ghost" href="/safety">How to look safely</a>
		</div>
	</div>
</section>

<section class="shell">
	<div class="note note-danger">
		<strong>Before anything else:</strong> looking at even a sliver of the uncovered Sun will damage
		your eyes, and it does not hurt while it happens. You need eclipse glasses certified to ISO
		12312-2, or a proper solar filter in front of any camera, binoculars or telescope. Only inside
		the narrow band of totality, and only while the Sun is completely covered, is it safe to look
		with the naked eye. <a href="/safety">Read the safety page.</a>
	</div>

	<h2>The numbers</h2>
	<div class="grid grid-3">
		<div class="card stat">
			<span class="stat-value">{formatDuration(ECLIPSE_FACTS.maxTotalitySeconds)}</span>
			<span class="stat-label">Longest totality</span>
		</div>
		<div class="card stat">
			<span class="stat-value">{ECLIPSE_FACTS.pathWidthKm} km</span>
			<span class="stat-label">Path width at greatest eclipse</span>
		</div>
		<div class="card stat">
			<span class="stat-value">96 min</span>
			<span class="stat-label">Umbra's run across the Earth</span>
		</div>
		<div class="card stat">
			<span class="stat-value">{ECLIPSE_FACTS.diameterRatio}×</span>
			<span class="stat-label">Moon's diameter vs the Sun's</span>
		</div>
		<div class="card stat">
			<span class="stat-value">{ECLIPSE_FACTS.greatestEclipseSunAltitude}°</span>
			<span class="stat-label">Sun's height at greatest eclipse</span>
		</div>
		<div class="card stat">
			<span class="stat-value">126</span>
			<span class="stat-label">Saros series</span>
		</div>
	</div>

	<h2>Where and when</h2>
	<div class="prose">
		<p>
			The Moon's shadow touches the Earth at <strong>{formatUtc(UMBRA_FIRST_CONTACT)} UTC</strong> and
			leaves at <strong>{formatUtc(UMBRA_LAST_CONTACT)} UTC</strong>. Somewhere on Earth a partial
			eclipse is under way from {formatUtc(PARTIAL_FIRST_CONTACT)} to
			{formatUtc(PARTIAL_LAST_CONTACT)} UTC.
		</p>
		<p>
			The track is unusual in that it runs backwards across the map compared with most eclipses —
			from the Arctic south-west then south-east — and it ends with the Sun setting. That last detail
			shapes everything about watching it from Spain: the Sun is between about 12° and 2° above the
			horizon during totality, so you need an unobstructed view towards the west-north-west, and
			hills, buildings or a bank of coastal cloud will simply take the event away from you.
		</p>
	</div>

	<ol class="timeline">
		{#each timeline as entry (entry.title)}
			<li>
				<time datetime={entry.utc.toISOString()}>{formatUtc(entry.utc, false)} UTC</time>
				<div>
					<h3>{entry.title}</h3>
					<p>{entry.detail}</p>
				</div>
			</li>
		{/each}
	</ol>

	<h2>What this site does</h2>
	<div class="grid grid-2">
		<div class="card">
			<h3>Computes, rather than copies</h3>
			<p>
				Every time, duration and angle here is worked out in your browser from the Besselian
				elements NASA publishes for this eclipse. Pick any point on Earth and it will solve for the
				four contact times, the depth of the eclipse and the Sun's position in your sky.
			</p>
		</div>
		<div class="card">
			<h3>Shows what you will actually see</h3>
			<p>
				The <a href="/simulator">simulator</a> places the Moon on the Sun using that same geometry, at
				the right size ratio and turned the right way up for your horizon — including the low, reddened
				Sun that makes the Spanish view so distinctive.
			</p>
		</div>
		<div class="card">
			<h3>Is honest about the edges</h3>
			<p>
				Bilbao gets about half a minute of totality; Madrid, a few kilometres further south, gets
				none. The site says so, and warns you when your position is close enough to a limit that the
				Moon's ragged edge makes the answer uncertain.
			</p>
		</div>
		<div class="card">
			<h3>Works out the weather odds</h3>
			<p>
				<a href="/where">Where to watch</a> pairs each city's circumstances with its August cloud
				climatology, so you can weigh a longer totality against a better chance of actually seeing
				it. It is not a forecast — check one of those too.
			</p>
		</div>
	</div>
</section>

<style>
	.hero {
		padding: 3rem 0 1rem;
		background:
			radial-gradient(ellipse 70% 60% at 50% -10%, rgba(124, 92, 255, 0.18), transparent 70%),
			radial-gradient(ellipse 40% 40% at 80% 10%, rgba(255, 181, 69, 0.1), transparent 70%);
	}

	.kicker {
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.8rem;
		color: var(--sun);
		font-weight: 600;
		margin-bottom: 0.75rem;
	}

	.hero h1 {
		max-width: 20ch;
	}

	.hero .lede {
		max-width: 62ch;
	}

	.countdown {
		margin: 2rem 0 1.5rem;
		max-width: 620px;
	}

	.countdown-title {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-faint);
		margin-bottom: 0.6rem;
	}

	.countdown-title.live {
		color: var(--sun);
		font-size: 1.1rem;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 650;
	}

	.countdown-note {
		margin: 0.6rem 0 0;
		font-size: 0.9rem;
		color: var(--text-dim);
	}

	.clock {
		display: flex;
		gap: 1.5rem;
	}

	.clock span {
		display: flex;
		flex-direction: column;
	}

	.clock b {
		font-size: clamp(1.8rem, 6vw, 2.8rem);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.03em;
		line-height: 1;
	}

	.clock i {
		font-style: normal;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-faint);
		margin-top: 0.3rem;
	}

	.actions {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.timeline {
		list-style: none;
		padding: 0;
		margin: 1.5rem 0 0;
		border-left: 2px solid var(--border);
	}

	.timeline li {
		display: grid;
		grid-template-columns: 7.5rem 1fr;
		gap: 1rem;
		padding: 0 0 1.5rem 1.25rem;
		position: relative;
		margin: 0;
	}

	.timeline li::before {
		content: '';
		position: absolute;
		left: -6px;
		top: 0.55rem;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--sun);
	}

	.timeline time {
		font-variant-numeric: tabular-nums;
		color: var(--sun);
		font-weight: 600;
		font-size: 0.9rem;
		padding-top: 0.15rem;
	}

	.timeline h3 {
		margin: 0 0 0.25rem;
		font-size: 1.05rem;
	}

	.timeline p {
		margin: 0;
		color: var(--text-dim);
	}

	@media (max-width: 640px) {
		.timeline li {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}
	}
</style>
