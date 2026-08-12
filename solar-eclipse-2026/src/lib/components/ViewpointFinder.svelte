<script lang="ts">
	import { onMount } from 'svelte';
	import LocationPicker from './LocationPicker.svelte';
	import { localCircumstances } from '$lib/eclipse/local';
	import { compassPoint } from '$lib/eclipse/horizon';
	import {
		findViewpoints,
		googleEmbedUrl,
		mapsDirectionsUrl,
		mapsPlaceUrl,
		streetViewUrl,
		type ScoredSpot
	} from '$lib/eclipse/viewpoints';
	import SpotMap from './SpotMap.svelte';
	import { labelForKind } from '$lib/data/overpass';
	import { timeZoneFor } from '$lib/data/timezone';
	import { formatClock, formatDegrees, formatPercent } from '$lib/format';

	interface Props {
		lat?: number;
		lon?: number;
		label?: string;
	}

	let { lat = 47.6573, lon = 23.5681, label = 'Baia Mare, Romania' }: Props = $props();

	let elevation = $state(0);
	let radiusKm = $state(30);

	// The simulator links here with a position attached. Read it after mount
	// rather than from the page store: this page is prerendered, and query
	// parameters do not exist at build time.
	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const nextLat = Number(params.get('lat'));
		const nextLon = Number(params.get('lon'));
		if (!Number.isFinite(nextLat) || !Number.isFinite(nextLon)) return;
		if (Math.abs(nextLat) > 90 || Math.abs(nextLon) > 180) return;
		lat = nextLat;
		lon = nextLon;
		label = params.get('place') || 'Your position';
	});
	let busy = $state(false);
	let progress = $state('');
	let error = $state('');
	let origin = $state<ScoredSpot | null>(null);
	let spots = $state<ScoredSpot[]>([]);
	let searched = $state(false);
	let selectedId = $state<string | null>(null);
	let mapMode = $state<'satellite' | 'map'>('satellite');
	let controller: AbortController | null = null;

	const shown = $derived(origin ? [origin, ...spots] : spots);
	const selected = $derived(
		shown.find((s) => s.spot.id === selectedId) ?? shown[0] ?? null
	);

	const timeZone = $derived(timeZoneFor(lat, lon));
	const local = $derived(localCircumstances({ lat, lon }));
	const sunMoment = $derived(local.bestVisible ?? local.max);

	function setPlace(next: { lat: number; lon: number; elevation: number; label: string }) {
		lat = next.lat;
		lon = next.lon;
		elevation = next.elevation;
		label = next.label;
		// The old answers belong to the old place.
		spots = [];
		origin = null;
		searched = false;
		selectedId = null;
		error = '';
	}

	async function run() {
		controller?.abort();
		controller = new AbortController();
		busy = true;
		error = '';
		progress = '';
		try {
			const result = await findViewpoints({ lat, lon }, radiusKm * 1000, {
				signal: controller.signal,
				onProgress: (report) => (progress = report.message)
			});
			origin = result.origin;
			spots = result.spots;
			searched = true;
			// Preselect the best-placed spot so the map has something to show.
			selectedId = result.spots[0]?.spot.id ?? result.origin?.spot.id ?? null;
			if (result.spotsUnavailable) {
				error = `${result.spotsUnavailable} Your own position is still checked below.`;
			} else if (!result.found) {
				error = `OpenStreetMap has no mapped viewpoints, car parks or picnic sites within ${radiusKm} km. Try a wider radius.`;
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			error = caught instanceof Error ? caught.message : 'Something went wrong.';
		} finally {
			busy = false;
			progress = '';
		}
	}

	function stop() {
		controller?.abort();
		busy = false;
		progress = '';
	}

	function km(metres: number): string {
		return metres < 950 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;
	}
</script>

<div class="finder">
	<div class="card setup">
		<h3>1 · Where are you starting from?</h3>
		<LocationPicker {lat} {lon} {elevation} {label} onchange={setPlace} />
	</div>

	<div class="card setup">
		<h3>2 · How far are you willing to drive?</h3>
		<div class="radii">
			{#each [15, 30, 60] as option (option)}
				<button class:active={radiusKm === option} onclick={() => (radiusKm = option)}>
					{option} km
				</button>
			{/each}
		</div>

		{#if local.hasEclipse && !local.belowHorizon}
			<p class="sun-note">
				From here the Sun will be <strong>{formatDegrees(sunMoment.altitude)}</strong> above the
				horizon at the best moment ({formatClock(sunMoment.time, timeZone)} local), bearing
				{formatDegrees(sunMoment.azimuth, 0)} — {compassPoint(sunMoment.azimuth)}. Anything on the
				skyline higher than that hides it.
			</p>
		{:else}
			<p class="sun-note warn">
				The eclipse is not visible from this starting point — the Sun is below the horizon
				throughout. Move somewhere further west before looking for a viewpoint.
			</p>
		{/if}

		<div class="actions">
			<button class="primary" onclick={run} disabled={busy}>
				{busy ? 'Searching…' : 'Find viewing spots'}
			</button>
			{#if busy}<button onclick={stop}>Cancel</button>{/if}
		</div>
		{#if progress}<p class="progress">{progress}</p>{/if}
		{#if error}<p class="failed">{error}</p>{/if}
	</div>
</div>

{#if origin}
	<div class="card origin">
		<div class="row-main">
			<div>
				<h3>Where you are now</h3>
				<p class="detail">
					Ground {Math.round(origin.elevationM)} m · skyline
					{formatDegrees(origin.horizon.angle, 1)} towards the Sun
					{#if origin.horizon.atDistanceM}
						(set by ground {km(origin.horizon.atDistanceM)} away)
					{/if}
				</p>
			</div>
			<span class="verdict verdict-{origin.verdict.quality}">{origin.verdict.label}</span>
		</div>
		<p class="detail">
			{#if origin.verdict.quality === 'blocked'}
				The terrain towards the setting Sun stands higher than the Sun will be, so you need to move.
			{:else if origin.verdict.quality === 'marginal'}
				Only {formatDegrees(origin.verdict.clearanceDeg, 1)} of clearance — a line of trees or a
				building would be enough to spoil it.
			{:else}
				{formatDegrees(origin.verdict.clearanceDeg, 1)} of clearance above the skyline.
			{/if}
		</p>
	</div>
{/if}

{#if spots.length}
	<h3 class="results-heading">Places you could drive to</h3>
	<p class="results-note">
		Ranked by how far the Sun clears the skyline in the direction it will actually be. Heights come
		from a 90 m elevation model, which knows about hills but not about trees, hedges or buildings —
		so check the satellite view and the Street View link before committing.
	</p>

	<div class="results-layout">
		<ul class="spots">
			{#each shown as item (item.spot.id)}
				<li>
					<button
						class="spot"
						class:chosen={selected?.spot.id === item.spot.id}
						onclick={() => (selectedId = item.spot.id)}
					>
						<span class="row-main">
							<span class="who">
								<strong>{item.spot.name}</strong>
								<span class="kind">{item.spot.detail ?? labelForKind(item.spot.kind)}</span>
								{#if item.spot.canLinger}
									<span class="kind stay" title="Somewhere you can settle in for an hour">
										stay a while
									</span>
								{/if}
								{#if !item.spot.drivable}
									<span class="kind walk" title="A summit — check whether a road goes up">
										may need a walk
									</span>
								{/if}
							</span>
							<span class="verdict verdict-{item.verdict.quality}">{item.verdict.label}</span>
						</span>
						<span class="detail">
							{item.spot.id === 'origin' ? 'your starting point' : km(item.distanceM) + ' ' + compassPoint(item.bearingDeg)}
							· ground {Math.round(item.elevationM)} m · skyline
							{formatDegrees(item.horizon.angle, 1)} vs Sun at
							{formatDegrees(item.sunAltitudeDeg, 1)}
							{#if item.isTotal}
								· <span class="total">totality</span>
							{:else if item.obscuration > 0}
								· {formatPercent(item.obscuration, 0)} covered
							{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>

		<div class="map-column">
			<SpotMap
				{origin}
				{spots}
				{selected}
				onselect={(spot) => (selectedId = spot.spot.id)}
				height={360}
			/>

			{#if selected}
				<div class="card panel">
					<div class="panel-head">
						<div>
							<strong>{selected.spot.name}</strong>
							<span class="detail">
								looking {compassPoint(selected.sunAzimuthDeg)} ·
								{formatDegrees(selected.sunAzimuthDeg, 0)}
							</span>
						</div>
						<div class="mode">
							<button class:active={mapMode === 'satellite'} onclick={() => (mapMode = 'satellite')}>
								Satellite
							</button>
							<button class:active={mapMode === 'map'} onclick={() => (mapMode = 'map')}>
								Map
							</button>
						</div>
					</div>

					<iframe
						title="Google Maps view of {selected.spot.name}"
						src={googleEmbedUrl(selected.spot, mapMode)}
						loading="lazy"
						referrerpolicy="no-referrer-when-downgrade"
					></iframe>

					<p class="detail">
						On satellite, look {compassPoint(selected.sunAzimuthDeg)} from the pin: open ground or
						water means a clean horizon, a belt of trees or a ridge means trouble.
					</p>

					<div class="links">
						<a href={mapsDirectionsUrl(selected.spot)} target="_blank" rel="noreferrer noopener">
							Directions
						</a>
						<a
							href={streetViewUrl(selected.spot, selected.sunAzimuthDeg)}
							target="_blank"
							rel="noreferrer noopener"
							title="Street View looking towards where the Sun will set"
						>
							Look towards the Sun
						</a>
						<a href={mapsPlaceUrl(selected.spot)} target="_blank" rel="noreferrer noopener">
							Open in Maps
						</a>
					</div>
				</div>
			{/if}
		</div>
	</div>
{:else if searched && !error && !busy}
	<p class="results-note">
		Nothing suitable was mapped within {radiusKm} km. Try a wider radius, or pick a spot yourself on
		the simulator map and check its skyline there.
	</p>
{/if}

<p class="credit">
	Viewing spots from OpenStreetMap contributors via Overpass. Ground heights from Open-Meteo
	(Copernicus DEM). Map links open Google Maps.
</p>

<style>
	.finder {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 1rem;
		margin-bottom: 1.25rem;
	}

	.setup h3,
	.origin h3 {
		margin-top: 0;
		font-size: 1rem;
	}

	.radii {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
	}

	.sun-note {
		font-size: 0.9rem;
		color: var(--text-dim);
	}

	.sun-note.warn {
		color: var(--sun);
	}

	.actions {
		display: flex;
		gap: 0.5rem;
	}

	.progress {
		margin: 0.6rem 0 0;
		font-size: 0.85rem;
		color: var(--text-faint);
	}

	.failed {
		margin: 0.6rem 0 0;
		font-size: 0.88rem;
		color: var(--danger);
	}

	.origin {
		margin-bottom: 1.25rem;
	}

	.row-main {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.who {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.kind {
		font-size: 0.75rem;
		color: var(--text-faint);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.05rem 0.4rem;
	}

	.kind.walk {
		color: var(--sun);
		border-color: #5a4a24;
		cursor: help;
	}

	.verdict {
		flex: none;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		white-space: nowrap;
	}

	.verdict-clear {
		background: #123021;
		border-color: #2f6b45;
		color: #7ee2a8;
	}

	.verdict-likely {
		background: #1e2c1c;
		border-color: #3f6b30;
		color: #b6e08c;
	}

	.verdict-marginal {
		background: #2b2416;
		border-color: #5a4a24;
		color: var(--sun-bright);
	}

	.verdict-blocked {
		background: #2e1a1a;
		border-color: #6b3030;
		color: #ffa9a1;
	}

	.detail {
		margin: 0.4rem 0 0;
		font-size: 0.86rem;
		color: var(--text-dim);
	}

	.total {
		color: #c7bcff;
		font-weight: 600;
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.6rem;
		font-size: 0.86rem;
	}

	.results-heading {
		margin-top: 2rem;
	}

	.results-note {
		color: var(--text-dim);
		font-size: 0.9rem;
		max-width: 72ch;
	}

	.results-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
		gap: 1rem;
		align-items: start;
		margin-top: 1rem;
	}

	@media (max-width: 900px) {
		.results-layout {
			grid-template-columns: 1fr;
		}
	}

	.spots {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.5rem;
		max-height: 760px;
		overflow-y: auto;
	}

	.spots li {
		margin: 0;
	}

	.spot {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		width: 100%;
		text-align: left;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.7rem 0.85rem;
	}

	.spot:hover {
		border-color: var(--border-strong);
	}

	.spot.chosen {
		border-color: var(--sun);
		background: rgba(255, 181, 69, 0.07);
	}

	.map-column {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		position: sticky;
		top: 76px;
	}

	.panel {
		padding: 0.85rem;
	}

	.panel-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.6rem;
	}

	.panel-head .detail {
		display: block;
		margin: 0;
	}

	.mode {
		display: flex;
		gap: 0.25rem;
		flex: none;
	}

	.mode button {
		font-size: 0.78rem;
		padding: 0.2rem 0.5rem;
	}

	.panel iframe {
		display: block;
		width: 100%;
		height: 300px;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--bg-raised);
	}

	.kind.stay {
		color: #7ee2a8;
		border-color: #2f6b45;
	}

	.credit {
		margin-top: 1.25rem;
		font-size: 0.76rem;
		color: var(--text-faint);
	}
</style>
