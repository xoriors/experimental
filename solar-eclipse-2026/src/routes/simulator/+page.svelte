<script lang="ts">
	import { onMount } from 'svelte';
	import SkyView from '$lib/components/SkyView.svelte';
	import EclipseMap from '$lib/components/EclipseMap.svelte';
	import LocationPicker from '$lib/components/LocationPicker.svelte';
	import { tToUtc, utcToT, type Observer } from '$lib/eclipse/besselian';
	import { localCircumstances, refraction, skyGeometry, sunIsUp } from '$lib/eclipse/local';
	import { PATH_PLACES } from '$lib/data/places';
	import {
		compass,
		formatClock,
		formatCoordinate,
		formatDegrees,
		formatDuration,
		formatPercent,
		formatUtc,
		zoneAbbreviation
	} from '$lib/format';
	import { describeTimeZone, timeZoneFor } from '$lib/data/timezone';

	// Start on the centre line in Castile, which is both a realistic destination
	// and the clearest demonstration of a low-Sun totality.
	let lat = $state(42.0096);
	let lon = $state(-4.5288);
	let elevation = $state(740);
	let label = $state('Palencia, Spain');

	let t = $state(utcToT(new Date('2026-08-12T18:30:20Z')));
	let playing = $state(false);
	let speed = $state(10);
	let fieldOfView = $state(12);
	let showLandscape = $state(true);
	let showLabels = $state(true);
	let applyRefraction = $state(true);

	const observer = $derived<Observer>({ lat, lon, elevation });
	const local = $derived(localCircumstances(observer));
	const geometry = $derived(skyGeometry(t, observer));
	const time = $derived(tToUtc(t));

	// Times are always shown in the local zone of the place being simulated, not
	// the browser's. Deriving the zone from the coordinates keeps it correct no
	// matter how the position was set — search, map click, geolocation or typed
	// coordinates — so it can never fall out of step with the marker.
	const timeZone = $derived(timeZoneFor(lat, lon));
	const zoneLabel = $derived(describeTimeZone(timeZone));
	const zoneShort = $derived(zoneAbbreviation(time, timeZone));
	const zoneDisplay = $derived(zoneShort ? `${zoneLabel} (${zoneShort})` : zoneLabel);

	// Scrub across the observer's own eclipse where there is one, otherwise the
	// window in which the shadow is on the Earth at all.
	const range = $derived(
		local.c1 && local.c4
			? { start: local.c1.t - 0.06, end: local.c4.t + 0.06 }
			: { start: utcToT(new Date('2026-08-12T15:35:00Z')), end: utcToT(new Date('2026-08-12T19:58:00Z')) }
	);

	const contacts = $derived(
		[
			{ key: 'C1', label: 'First contact', info: local.c1 },
			{ key: 'C2', label: 'Totality begins', info: local.c2 },
			{ key: 'MAX', label: 'Maximum', info: local.max },
			{ key: 'C3', label: 'Totality ends', info: local.c3 },
			{ key: 'C4', label: 'Last contact', info: local.c4 }
		].filter((c) => c.info !== null)
	);

	/** How close the observer is to a limit, where the Moon's edge blurs the answer. */
	const edgeWarning = $derived.by(() => {
		const margin = Math.abs(local.maxMagnitude - 1);
		// A magnitude within ~0.0015 of 1 corresponds to roughly a kilometre or two.
		if (margin > 0.004) return null;
		return local.isTotal
			? 'You are within about a kilometre of the edge of the path. The Moon has mountains, so the real limit wobbles by a kilometre or two — move further towards the centre line to be sure.'
			: 'You are barely outside the path — close enough that the exact limit is uncertain by a kilometre or two. A short drive towards the centre line would settle it.';
	});

	const belowHorizon = $derived(!sunIsUp(geometry.altitude));

	let lastFrame = 0;
	onMount(() => {
		let raf = 0;
		const step = (now: number) => {
			raf = requestAnimationFrame(step);
			if (!playing) {
				lastFrame = now;
				return;
			}
			const delta = Math.min(0.1, (now - lastFrame) / 1000);
			lastFrame = now;
			t += (delta * speed) / 3600;
			if (t > range.end) {
				t = range.end;
				playing = false;
			}
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	});

	function jumpTo(target: number) {
		t = target;
		playing = false;
	}

	function pickPlace(next: { lat: number; lon: number; elevation: number; label: string }) {
		lat = next.lat;
		lon = next.lon;
		elevation = next.elevation;
		label = next.label;
		const fresh = localCircumstances({ lat: next.lat, lon: next.lon, elevation: next.elevation });
		t = fresh.max.t;
		playing = false;
	}

	function pickFromMap(nextLat: number, nextLon: number) {
		lat = Number(nextLat.toFixed(4));
		lon = Number(nextLon.toFixed(4));
		elevation = 0;
		label = 'Map position';
		const fresh = localCircumstances({ lat, lon, elevation });
		t = fresh.max.t;
		playing = false;
	}

	const displayedAltitude = $derived(
		geometry.altitude + (applyRefraction ? refraction(geometry.altitude) : 0)
	);
</script>

<svelte:head>
	<title>Eclipse simulator — 12 August 2026</title>
	<meta
		name="description"
		content="Watch the 12 August 2026 total solar eclipse from any point on Earth: a physically computed simulation of the sky, with contact times, the Sun's height and the shadow's position."
	/>
</svelte:head>

<div class="shell">
	<h1>Eclipse simulator</h1>
	<p class="lede">
		Everything below is computed from the eclipse's Besselian elements for the exact place and instant
		you choose — the Moon's size relative to the Sun, which way up the bite appears, how far the Sun
		has sunk, and which planets come out. Drag the sky to look around; scrub time with the slider.
	</p>
</div>

<div class="shell sim">
	<div class="stage">
		<SkyView
			{observer}
			{time}
			{t}
			{fieldOfView}
			{showLandscape}
			{showLabels}
			{applyRefraction}
		/>
		<div class="stage-readout">
			<span
				class="pill {!sunIsUp(geometry.altitude)
					? 'pill-none'
					: local.isTotal
						? 'pill-total'
						: local.hasEclipse
							? 'pill-partial'
							: 'pill-none'}"
			>
				{#if !sunIsUp(geometry.altitude)}
					Sun below horizon
				{:else if geometry.obscuration >= 1}
					Totality
				{:else if geometry.obscuration > 0}
					{formatPercent(geometry.obscuration, 1)} covered
				{:else}
					No eclipse yet
				{/if}
			</span>
			<span class="clock-readout">
				{formatClock(time, timeZone, true)}{#if zoneShort}<em>{zoneShort}</em>{/if}
			</span>
			<span class="utc">{formatUtc(time)} UTC</span>
		</div>
	</div>

	<div class="view-bar card">
		<h2 class="view-title">View</h2>
		<div class="view-zoom">
			<label for="fov-slider">
				Field of view
				<b>{fieldOfView < 5 ? fieldOfView.toFixed(1) : fieldOfView.toFixed(0)}° tall</b>
			</label>
			<input id="fov-slider" type="range" min="0.6" max="90" step="0.2" bind:value={fieldOfView} />
		</div>
		<div class="zoom-presets">
			<button onclick={() => (fieldOfView = 60)}>Landscape</button>
			<button onclick={() => (fieldOfView = 12)}>Normal</button>
			<button onclick={() => (fieldOfView = 2.5)}>Telephoto</button>
			<button onclick={() => (fieldOfView = 0.8)}>Corona detail</button>
		</div>
		<div class="view-toggles">
			<label class="check"><input type="checkbox" bind:checked={showLandscape} /> Horizon</label>
			<label class="check"><input type="checkbox" bind:checked={showLabels} /> Labels</label>
			<label class="check">
				<input type="checkbox" bind:checked={applyRefraction} /> Refraction
			</label>
		</div>
		<p class="hint">
			Zoom right in around second and third contact to catch Baily's beads — the last points of
			sunlight shining through valleys on the Moon's edge.
		</p>
	</div>

	<div class="scrub card">
		<div class="transport">
			<button class="primary" onclick={() => (playing = !playing)}>
				{playing ? 'Pause' : 'Play'}
			</button>
			<div class="speeds">
				{#each [1, 10, 60, 300] as option (option)}
					<button class:active={speed === option} onclick={() => (speed = option)}>
						{option}×
					</button>
				{/each}
			</div>
			<div class="jumps">
				{#each contacts as contact (contact.key)}
					<button onclick={() => jumpTo(contact.info!.t)} title={contact.label}>
						{contact.key}
					</button>
				{/each}
			</div>
		</div>

		<label class="visually-hidden" for="time-scrub">Time</label>
		<input
			id="time-scrub"
			type="range"
			min={range.start}
			max={range.end}
			step={0.5 / 3600}
			bind:value={t}
		/>
		<div class="scrub-ends">
			<span>{formatClock(tToUtc(range.start), timeZone)}</span>
			<span class="scrub-zone">local time in {zoneLabel}</span>
			<span>{formatClock(tToUtc(range.end), timeZone)}</span>
		</div>
	</div>

	<div class="card position-card">
		<h2>Your position</h2>
		<LocationPicker {lat} {lon} {elevation} {label} onchange={pickPlace} />
		<p class="coords">{formatCoordinate(lat, lon)} · {Math.round(elevation)} m</p>
	</div>

	<h2>Where the shadow is</h2>
	<p class="map-hint">
		Click anywhere to move your viewpoint there. The dark outline is the umbra at the instant shown
		in the sky view above; the shaded band is the path of totality and the purple wash is how much of
		the Sun is covered elsewhere.
	</p>
	<EclipseMap
		{observer}
		{t}
		onpick={pickFromMap}
		markers={PATH_PLACES.map((p) => ({ lat: p.lat, lon: p.lon, name: p.name }))}
		height={480}
	/>

	<div class="panels">
		<div class="card">
			<h2>What happens here</h2>
			{#if !local.hasEclipse}
				<p>No part of the Sun is covered from this position — you are off the eclipse entirely.</p>
			{:else}
				<p class="verdict">
					{#if local.belowHorizon}
						<strong class="none">Not visible from here.</strong>
						The whole eclipse happens after the Sun has set.
					{:else if local.isTotal}
						<strong class="total">Totality lasting {formatDuration(local.totalitySeconds)}.</strong>
						The Sun is {formatDegrees(local.max.altitude)} above the horizon at mid-eclipse.
					{:else}
						<strong class="partial">
							Partial eclipse, {formatPercent(local.visibleObscuration, 1)} of the Sun covered{
								local.partlyBelowHorizon ? ' before it sets' : ''
							}.
						</strong>
						Never safe to look at without a filter.
					{/if}
				</p>

				{#if local.belowHorizon}
					<div class="note note-danger">
						The Moon covers up to {formatPercent(local.maxObscuration, 1)} of the Sun at this
						longitude, but all of that happens below your horizon. You would need to be
						considerably further west to see any of it.
					</div>
				{:else if local.partlyBelowHorizon && local.maxObscuration - local.visibleObscuration > 0.01}
					<div class="note">
						The Sun sets partway through. It reaches {formatPercent(local.maxObscuration, 1)}
						covered, but only {formatPercent(local.visibleObscuration, 1)} of that happens while
						the Sun is still above your horizon — the rest is below it.
					</div>
				{/if}

				{#if edgeWarning}
					<div class="note">{edgeWarning}</div>
				{/if}

				<div class="table-scroll">
					<table>
						<thead>
							<tr>
								<th>Event</th>
								<th>Local</th>
								<th>UTC</th>
								<th class="num">Sun alt.</th>
							</tr>
						</thead>
						<tbody>
							{#each contacts as contact (contact.key)}
								{@const set = !sunIsUp(contact.info!.altitude)}
								<tr class:highlight={contact.key === 'C2' || contact.key === 'C3'} class:set>
									<td>{contact.label}</td>
									<td>{formatClock(contact.info!.time, timeZone, true)}</td>
									<td>{formatUtc(contact.info!.time)}</td>
									<td class="num">
										{formatDegrees(contact.info!.altitude)}
										{#if set}<span title="Sun below the horizon">↓</span>{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="tz">
					Local times are for {zoneDisplay} — the zone at the position you picked, not your
					device's.
				</p>
			{/if}
		</div>

		<div class="card">
			<h2>Right now in the simulation</h2>
			<dl class="readout">
				<div><dt>Sun covered</dt><dd>{formatPercent(geometry.obscuration, 2)}</dd></div>
				<div><dt>Magnitude</dt><dd>{geometry.magnitude > 0 ? geometry.magnitude.toFixed(3) : '—'}</dd></div>
				<div>
					<dt>Sun altitude</dt>
					<dd>
						{formatDegrees(displayedAltitude, 2)}
						{#if applyRefraction && Math.abs(displayedAltitude - geometry.altitude) > 0.02}
							<small>(refracted; true {formatDegrees(geometry.altitude, 2)})</small>
						{/if}
					</dd>
				</div>
				<div>
					<dt>Sun azimuth</dt>
					<dd>{formatDegrees(geometry.azimuth, 1)} <small>{compass(geometry.azimuth)}</small></dd>
				</div>
				<div><dt>Separation of centres</dt><dd>{(geometry.separation * 60).toFixed(1)}′</dd></div>
				<div>
					<dt>Moon / Sun size</dt>
					<dd>{(geometry.moonRadius / geometry.sunRadius).toFixed(4)}×</dd>
				</div>
			</dl>
			{#if belowHorizon}
				<p class="warn">The Sun is below the horizon at this instant.</p>
			{/if}
		</div>

	</div>
</div>

<style>
	.sim {
		padding-bottom: 2rem;
	}

	.stage {
		position: relative;
		height: clamp(320px, 52vh, 560px);
		margin-bottom: 0.75rem;
	}

	.stage-readout {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.3rem;
		background: rgba(6, 7, 13, 0.7);
		padding: 0.5rem 0.7rem;
		border-radius: 9px;
		pointer-events: none;
	}

	.clock-readout {
		font-variant-numeric: tabular-nums;
		font-size: 1.25rem;
		font-weight: 650;
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
	}

	.clock-readout em {
		font-style: normal;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	.utc {
		font-size: 0.78rem;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.scrub {
		margin-bottom: 1.25rem;
	}

	.transport {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.speeds,
	.jumps {
		display: flex;
		gap: 0.25rem;
	}

	.speeds button,
	.jumps button {
		padding: 0.3rem 0.55rem;
		font-size: 0.85rem;
	}

	.jumps {
		margin-left: auto;
	}

	.scrub-ends {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		font-size: 0.78rem;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.scrub-zone {
		font-variant-numeric: normal;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.panels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1rem;
		margin: 1.5rem 0 2rem;
	}

	.panels h2 {
		margin-top: 0;
		font-size: 1.05rem;
	}

	.coords {
		margin: 0.6rem 0 0;
		font-size: 0.82rem;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.verdict strong.total {
		color: #c7bcff;
		display: block;
	}

	.verdict strong.partial {
		color: var(--sun-bright);
		display: block;
	}

	.verdict strong.none {
		color: var(--text-faint);
		display: block;
	}

	tr.set td {
		color: var(--text-faint);
	}

	tr.set td span {
		cursor: help;
	}

	.readout {
		margin: 0;
		display: grid;
		gap: 0.4rem;
	}

	.readout div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.35rem;
	}

	.readout dt {
		color: var(--text-faint);
		font-size: 0.88rem;
	}

	.readout dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.readout small {
		color: var(--text-faint);
		font-size: 0.76rem;
	}

	tr.highlight td {
		background: rgba(124, 92, 255, 0.1);
	}

	.tz {
		font-size: 0.78rem;
		color: var(--text-faint);
		margin: 0.5rem 0 0;
	}

	/* Zoom and display controls sit directly under the canvas they act on, so
	   they are laid out as one compact bar rather than a tall card. */
	.view-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.7rem 1.4rem;
		padding: 0.7rem 1rem;
		margin-bottom: 0.75rem;
	}

	.view-title {
		margin: 0;
		font-size: 0.76rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--text-faint);
	}

	.view-zoom {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex: 1 1 240px;
		min-width: 200px;
	}

	.view-zoom label {
		font-size: 0.84rem;
		color: var(--text-dim);
		white-space: nowrap;
	}

	.view-zoom label b {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	.view-zoom input[type='range'] {
		flex: 1;
		min-width: 100px;
	}

	.zoom-presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.zoom-presets button {
		font-size: 0.82rem;
		padding: 0.25rem 0.55rem;
	}

	.view-toggles {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1rem;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.86rem;
		color: var(--text-dim);
		white-space: nowrap;
	}

	.hint {
		flex-basis: 100%;
		font-size: 0.8rem;
		color: var(--text-faint);
		margin: 0;
	}

	.position-card {
		margin-bottom: 1.5rem;
	}

	.position-card h2 {
		margin-top: 0;
		font-size: 1.05rem;
	}

	.warn {
		color: var(--sun);
		font-size: 0.85rem;
		margin: 0.5rem 0 0;
	}

	.map-hint {
		color: var(--text-dim);
		font-size: 0.92rem;
		max-width: 70ch;
	}
</style>
