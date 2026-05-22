<script lang="ts">
	import { view, toggleExpanded, effectiveConfig, setDayOverride, resetDayOverride } from '$lib/state.svelte';
	import MapView from './MapView.svelte';
	import DayTabs from './DayTabs.svelte';
	import ForecastTable from './ForecastTable.svelte';
	import TripFinder from './TripFinder.svelte';
	import { filterHoursForDay, localIsoDate } from '$lib/time';
	import { addRecent } from '$lib/client/recentPlaces.svelte';
	import type { DaylightDay, FusedHour, LabeledPoint, DayKey } from '$lib/types';

	type RouteMeta = {
		kind: 'waypoints';
		legCount: number;
		ferryLegs: number;
		seaLegs: number;
		straightLegs: number;
		totalKm: number;
	};

	let loading = $state(false);
	let error = $state<string | null>(null);
	let result = $state<{
		hours: FusedHour[];
		timezone: string;
		daylight: DaylightDay[];
		polyline: { lat: number; lon: number }[];
		route: RouteMeta;
	} | null>(null);

	const markers = $derived(view.waypoints);

	const polyline = $derived(loading ? undefined : (result?.polyline ?? undefined));

	function ptsParam(pts: LabeledPoint[]): string {
		return pts.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join('|');
	}

	$effect(() => {
		const pts = view.waypoints;
		if (pts.length < 2) {
			result = null;
			loading = false;
			return;
		}
		const ac = new AbortController();
		loading = true;
		error = null;
		const landParam = view.tripMode === 'land' ? '&land=1' : '';
		fetch(
			`/api/multi-route?pts=${encodeURIComponent(ptsParam(pts))}&samples=3&days=3${landParam}`,
			{ signal: ac.signal }
		)
			.then(async (r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				const data = (await r.json()) as {
					hours: FusedHour[];
					timezone: string;
					daylight?: DaylightDay[];
					polyline: { lat: number; lon: number }[];
					route: RouteMeta;
				};
				result = {
					hours: data.hours,
					timezone: data.timezone,
					daylight: data.daylight ?? [],
					polyline: data.polyline,
					route: data.route
				};
			})
			.catch((e: unknown) => {
				if (e instanceof DOMException && e.name === 'AbortError') return;
				error = e instanceof Error ? e.message : 'Fetch failed';
			})
			.finally(() => {
				loading = false;
			});
		return () => ac.abort();
	});

	const todayIso = $derived(localIsoDate());
	const eff = $derived(effectiveConfig(view.day));
	const dayHours = $derived(result ? filterHoursForDay(result.hours, view.day, todayIso) : []);
	const activeMode = $derived(eff.mode);

	function onMapPick(p: { lat: number; lon: number }) {
		const label = `Point ${view.waypoints.length + 1}`;
		const next = [...view.waypoints, { lat: p.lat, lon: p.lon, label }];
		view.waypoints = next;
		// Don't pollute Recent Places with map-tap waypoints; only labelled ones.
	}

	function removeWaypoint(i: number) {
		view.waypoints = view.waypoints.filter((_, idx) => idx !== i);
	}

	function moveWaypoint(i: number, dir: -1 | 1) {
		const next = [...view.waypoints];
		const j = i + dir;
		if (j < 0 || j >= next.length) return;
		[next[i], next[j]] = [next[j], next[i]];
		view.waypoints = next;
	}

	function clearAll() {
		view.waypoints = [];
	}

	function onDay(d: DayKey) {
		view.day = d;
	}

	// activeMode and dayHours are intentionally read inside the template;
	// these void-references silence the bundler's unused-import check.
	void addRecent;
</script>

<div class="card">
	<div class="muted" style="font-size: 0.9em;">
		<strong>Tap the map</strong> to drop waypoints in order — Weather Voodoo will route between them and forecast the trip.
		{#if view.tripMode === 'sea'}
			Sea mode tries to follow real ferry routes (OpenStreetMap) where possible.
		{:else}
			Land mode connects each pair with a straight line.
		{/if}
	</div>

	{#if view.waypoints.length > 0}
		<ol class="wp-list">
			{#each view.waypoints as wp, i (i + '-' + wp.lat + ',' + wp.lon)}
				<li class="wp-row">
					<span class="wp-num">{i + 1}</span>
					<span class="wp-label">
						{wp.label ?? `${wp.lat.toFixed(3)}, ${wp.lon.toFixed(3)}`}
					</span>
					<button
						type="button"
						class="wp-btn"
						title="Move up"
						aria-label="Move up"
						onclick={() => moveWaypoint(i, -1)}
						disabled={i === 0}
					>↑</button>
					<button
						type="button"
						class="wp-btn"
						title="Move down"
						aria-label="Move down"
						onclick={() => moveWaypoint(i, 1)}
						disabled={i === view.waypoints.length - 1}
					>↓</button>
					<button
						type="button"
						class="wp-btn wp-del"
						title="Remove waypoint"
						aria-label="Remove waypoint"
						onclick={() => removeWaypoint(i)}
					>×</button>
				</li>
			{/each}
		</ol>
		<div class="wp-actions">
			<button type="button" class="btn-ghost" onclick={clearAll}>↻ Clear all</button>
			<span class="muted" style="font-size: 0.85em;">{view.waypoints.length} point{view.waypoints.length === 1 ? '' : 's'}</span>
		</div>
	{:else}
		<div class="muted" style="font-size: 0.85em; margin-top: 0.6rem;">
			No waypoints yet — tap a spot on the map below to start.
		</div>
	{/if}

	{#if loading && view.waypoints.length >= 2}
		<div class="muted route-meta route-loading">
			<span class="spinner" aria-hidden="true"></span>
			Computing route &amp; fetching forecasts… first request in a region can take up to 15 s.
		</div>
	{:else if result?.route.kind === 'waypoints'}
		<div class="muted route-meta">
			🧭 Track: <strong>{result.route.totalKm.toFixed(0)} km</strong>
			· {result.route.legCount} leg{result.route.legCount === 1 ? '' : 's'}
			{#if result.route.ferryLegs > 0} · ⛴️ {result.route.ferryLegs} ferry{/if}
			{#if result.route.seaLegs > 0} · ⚓ {result.route.seaLegs} open-ocean{/if}
			{#if result.route.straightLegs > 0} · 📐 {result.route.straightLegs} straight{/if}
		</div>
	{/if}

	{#if error}
		<p style="color: var(--unsafe);">Error: {error}</p>
	{/if}
</div>

<div class="card map-card" style="padding: 0;">
	<MapView {markers} {polyline} onPick={onMapPick} />
	{#if loading && view.waypoints.length >= 2}
		<div class="map-loading" aria-live="polite">
			<span class="spinner" aria-hidden="true"></span>
			Computing route…
		</div>
	{/if}
</div>

{#if view.waypoints.length >= 2}
	{#if result}
		<TripFinder hours={result.hours} timezone={result.timezone} />
	{/if}
	<DayTabs day={view.day} onChange={onDay} />
	<div class="card">
		{#if loading}<p class="muted">Loading forecast…</p>{/if}
		{#if result}
			<p class="muted" style="margin-top: 0;">
				Forecast fused across 3 sample points along the track. Worst-case wind/wave/rain shown per hour. Times in {result.timezone}.
			</p>
			<ForecastTable
				allHours={result.hours}
				day={view.day}
				mode={activeMode}
				durationH={eff.durationH}
				minMin={eff.min}
				maxMin={eff.max}
				override={view.intervals[view.day]}
				topMinMin={view.tripMinMin}
				topMaxMin={view.tripMaxMin}
				topDurationH={view.tripDurationH}
				topMode={view.tripMode}
				onChangeOverride={(patch) => setDayOverride(view.day, patch)}
				onResetOverride={() => resetDayOverride(view.day)}
				expanded={view.expanded}
				onToggleSlot={toggleExpanded}
				{todayIso}
				daylight={result.daylight}
			/>
		{/if}
	</div>
{/if}

<style>
	.wp-list {
		list-style: none;
		padding: 0;
		margin: 0.6rem 0 0.3rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.wp-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg);
	}
	.wp-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.6rem;
		height: 1.6rem;
		border-radius: 999px;
		background: var(--mode-accent, var(--accent));
		color: #0b1220;
		font-weight: 700;
		font-size: 0.85em;
	}
	.wp-label {
		flex: 1 1 auto;
		font-size: 0.9em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wp-btn {
		min-width: 32px;
		min-height: 32px;
		padding: 0.2rem 0.4rem;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--fg-dim);
		font: inherit;
		cursor: pointer;
	}
	.wp-btn:hover:not(:disabled) {
		color: var(--fg);
		background: var(--bg-elev, rgba(255, 255, 255, 0.05));
	}
	.wp-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.wp-del:hover {
		color: var(--unsafe);
		border-color: var(--unsafe);
	}
	.wp-actions {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		margin-top: 0.4rem;
	}
	.route-meta {
		margin-top: 0.6rem;
		font-size: 0.85em;
	}
	.route-meta strong {
		color: var(--fg);
		font-variant-numeric: tabular-nums;
	}
	.route-loading {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}
	.spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		flex-shrink: 0;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	.map-card {
		position: relative;
	}
	.map-loading {
		position: absolute;
		top: 0.6rem;
		left: 50%;
		transform: translateX(-50%);
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.8rem;
		background: rgba(15, 23, 42, 0.85);
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 0.85em;
		z-index: 1;
		pointer-events: none;
		backdrop-filter: blur(4px);
	}
	@media (max-width: 720px) {
		.wp-label {
			font-size: 0.85em;
		}
	}
</style>
