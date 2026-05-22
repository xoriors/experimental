<script lang="ts">
	import { view, toggleExpanded, effectiveConfig, setDayOverride, resetDayOverride } from '$lib/state.svelte';
	import MapView from './MapView.svelte';
	import DayTabs from './DayTabs.svelte';
	import ForecastTable from './ForecastTable.svelte';
	import TripFinder from './TripFinder.svelte';
	import { filterHoursForDay, localIsoDate } from '$lib/time';
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

	// Edit-mode buffer. While `editing === true`, taps on the map mutate
	// `draft` only — we don't fetch routes or forecasts until the user
	// presses Done. On Done we commit `draft` into `view.waypoints`, which
	// triggers the route/forecast fetch.
	let editing = $state(view.waypoints.length === 0);
	let draft = $state<LabeledPoint[]>(view.waypoints.map((w) => ({ ...w })));

	function startEdit() {
		draft = view.waypoints.map((w) => ({ ...w }));
		editing = true;
		selectedIdx = null;
	}
	function cancelEdit() {
		draft = view.waypoints.map((w) => ({ ...w }));
		editing = false;
		selectedIdx = null;
	}
	function commitEdit() {
		view.waypoints = draft.map((w) => ({ ...w }));
		editing = false;
		selectedIdx = null;
	}
	function clearDraft() {
		draft = [];
		selectedIdx = null;
	}

	const committedMarkers = $derived(view.waypoints);
	const draftMarkers = $derived(draft);
	const markers = $derived(editing ? draftMarkers : committedMarkers);

	// While editing we draw a straight-line through the draft as a quick
	// preview; we don't hit the route API.
	const editPreview = $derived(
		editing && draft.length >= 2 ? draft.map((p) => ({ lat: p.lat, lon: p.lon })) : undefined
	);
	const polyline = $derived(
		editing ? editPreview : loading ? undefined : (result?.polyline ?? undefined)
	);

	function ptsParam(pts: LabeledPoint[]): string {
		return pts.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join('|');
	}

	$effect(() => {
		// Only fetch when the user has committed waypoints (i.e. not editing).
		if (editing) return;
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

	let selectedIdx: number | null = $state(null);

	function onMapPick(p: { lat: number; lon: number }) {
		if (!editing) return; // Map only adds points while editing.
		draft = [...draft, { lat: p.lat, lon: p.lon, label: `Point ${draft.length + 1}` }];
		selectedIdx = null;
	}
	function onMarkerTap(idx: number) {
		if (!editing) return;
		// Re-tapping the same marker closes the popup.
		selectedIdx = selectedIdx === idx ? null : idx;
	}
	function closeSelection() {
		selectedIdx = null;
	}

	function removeDraft(i: number) {
		draft = draft.filter((_, idx) => idx !== i);
		selectedIdx = null;
	}

	function moveDraft(i: number, dir: -1 | 1): number | null {
		const next = [...draft];
		const j = i + dir;
		if (j < 0 || j >= next.length) return null;
		[next[i], next[j]] = [next[j], next[i]];
		draft = next;
		return j;
	}

	function actionMoveBack() {
		if (selectedIdx === null) return;
		const newIdx = moveDraft(selectedIdx, -1);
		if (newIdx !== null) selectedIdx = newIdx;
	}
	function actionMoveForward() {
		if (selectedIdx === null) return;
		const newIdx = moveDraft(selectedIdx, 1);
		if (newIdx !== null) selectedIdx = newIdx;
	}
	function actionDelete() {
		if (selectedIdx === null) return;
		removeDraft(selectedIdx);
	}

	function onDay(d: DayKey) {
		view.day = d;
	}

	void dayHours;
</script>

<div class="card">
	<div class="wp-header">
		<div class="muted wp-help">
			{#if editing}
				<strong>Tap the map</strong> to add a waypoint, or <strong>tap an existing red marker</strong> to move it back/forward or delete it.
				A straight-line preview is drawn through the draft — press <strong>✓ Done</strong> to compute the real route and forecast.
			{:else}
				<strong>Track committed.</strong> Press <strong>✎ Change waypoints</strong> to edit.
			{/if}
		</div>
		<div class="wp-cta">
			{#if editing}
				{#if view.waypoints.length > 0}
					<button type="button" class="btn-ghost wp-cancel" onclick={cancelEdit}>Cancel</button>
				{/if}
				<button
					type="button"
					class="btn wp-done"
					onclick={commitEdit}
					disabled={draft.length < 2}
					title={draft.length < 2 ? 'Add at least 2 waypoints' : 'Compute route & forecasts'}
				>✓ Done</button>
			{:else}
				<button type="button" class="btn-ghost" onclick={startEdit}>✎ Change waypoints</button>
			{/if}
		</div>
	</div>

	{#if editing}
		{@const list = draft}
		{#if list.length > 0}
			<div class="wp-chips" role="list">
				{#each list as wp, i (i + '-' + wp.lat + ',' + wp.lon)}
					<div class="wp-chip" role="listitem">
						<span class="wp-num">{i + 1}</span>
						<button
							type="button"
							class="wp-btn"
							title="Move earlier"
							aria-label="Move earlier"
							onclick={() => moveDraft(i, -1)}
							disabled={i === 0}
						>←</button>
						<button
							type="button"
							class="wp-btn"
							title="Move later"
							aria-label="Move later"
							onclick={() => moveDraft(i, 1)}
							disabled={i === list.length - 1}
						>→</button>
						<button
							type="button"
							class="wp-btn wp-del"
							title="Remove waypoint"
							aria-label="Remove waypoint"
							onclick={() => removeDraft(i)}
						>×</button>
					</div>
				{/each}
			</div>
			<div class="wp-actions">
				<button type="button" class="btn-ghost" onclick={clearDraft}>↻ Clear all</button>
				<span class="muted wp-count">{list.length} point{list.length === 1 ? '' : 's'}</span>
			</div>
		{:else}
			<div class="muted wp-hint">No waypoints yet — tap the map below to start.</div>
		{/if}
	{:else if view.waypoints.length > 0}
		<div class="wp-chips" role="list">
			{#each view.waypoints as wp, i (i + '-' + wp.lat + ',' + wp.lon)}
				<div class="wp-chip wp-chip--compact" role="listitem">
					<span class="wp-num">{i + 1}</span>
					<span class="wp-coord">{wp.lat.toFixed(2)}, {wp.lon.toFixed(2)}</span>
				</div>
			{/each}
		</div>
	{/if}

	{#if !editing && loading && view.waypoints.length >= 2}
		<div class="muted route-meta route-loading">
			<span class="spinner" aria-hidden="true"></span>
			Computing route &amp; fetching forecasts… first request in a region can take up to 15 s.
		</div>
	{:else if !editing && result?.route.kind === 'waypoints'}
		<div class="muted route-meta">
			🧭 Track: <strong>{result.route.totalKm.toFixed(0)} km</strong>
			· {result.route.legCount} leg{result.route.legCount === 1 ? '' : 's'}
			{#if result.route.ferryLegs > 0} · ⛴️ {result.route.ferryLegs} ferry{/if}
			{#if result.route.seaLegs > 0} · ⚓ {result.route.seaLegs} open-ocean{/if}
			{#if result.route.straightLegs > 0} · 📐 {result.route.straightLegs} straight{/if}
		</div>
	{:else if editing && draft.length >= 2}
		<div class="muted route-meta">
			📐 Straight-line preview while editing — press Done to compute the real route.
		</div>
	{/if}

	{#if error}
		<p style="color: var(--unsafe);">Error: {error}</p>
	{/if}
</div>

<div class="card map-card" style="padding: 0;">
	<MapView
		{markers}
		{polyline}
		onPick={onMapPick}
		onMarkerTap={editing ? onMarkerTap : undefined}
		markerColor={editing ? '#ef4444' : '#38bdf8'}
		polylineColor={editing ? '#ef4444' : '#38bdf8'}
	/>
	{#if !editing && loading && view.waypoints.length >= 2}
		<div class="map-loading" aria-live="polite">
			<span class="spinner" aria-hidden="true"></span>
			Computing route…
		</div>
	{/if}
	{#if editing && selectedIdx !== null && draft[selectedIdx]}
		<div class="wp-popup" role="dialog" aria-label="Edit waypoint">
			<div class="wp-popup-title">
				Point <span class="wp-num">{selectedIdx + 1}</span>
			</div>
			<div class="wp-popup-actions">
				<button
					type="button"
					class="wp-popup-btn"
					onclick={actionMoveBack}
					disabled={selectedIdx === 0}
				>← Move back</button>
				<button
					type="button"
					class="wp-popup-btn"
					onclick={actionMoveForward}
					disabled={selectedIdx === draft.length - 1}
				>Move forward →</button>
				<button
					type="button"
					class="wp-popup-btn wp-popup-del"
					onclick={actionDelete}
				>× Delete</button>
				<button type="button" class="wp-popup-btn wp-popup-cancel" onclick={closeSelection}>Cancel</button>
			</div>
		</div>
	{/if}
</div>

{#if !editing && view.waypoints.length >= 2}
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
	.wp-header {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	.wp-help {
		flex: 1 1 240px;
		font-size: 0.88em;
		line-height: 1.4;
	}
	.wp-cta {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.wp-done {
		background: #4ade80;
		color: #052e16;
		border: 1px solid #4ade80;
		font-weight: 600;
		padding: 0.45rem 0.85rem;
		border-radius: 8px;
		cursor: pointer;
	}
	.wp-done:hover:not(:disabled) {
		filter: brightness(1.1);
	}
	.wp-done:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.wp-cancel {
		padding: 0.45rem 0.7rem;
	}
	.wp-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0.55rem 0 0.3rem;
	}
	.wp-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.35rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--bg);
		font-size: 0.85em;
	}
	.wp-chip--compact {
		padding: 0.2rem 0.55rem 0.2rem 0.35rem;
	}
	.wp-coord {
		font-variant-numeric: tabular-nums;
		color: var(--fg-dim);
		font-size: 0.92em;
	}
	.wp-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.5rem;
		height: 1.5rem;
		border-radius: 999px;
		background: var(--mode-accent, var(--accent));
		color: #0b1220;
		font-weight: 700;
		font-size: 0.85em;
	}
	.wp-btn {
		min-width: 28px;
		min-height: 28px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--fg-dim);
		font: inherit;
		cursor: pointer;
		line-height: 1;
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
	.wp-count {
		font-size: 0.85em;
	}
	.wp-hint {
		font-size: 0.85em;
		margin-top: 0.5rem;
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
	.wp-popup {
		position: absolute;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(15, 23, 42, 0.95);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 0.7rem 0.85rem;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
		z-index: 2;
		min-width: min(20rem, 92vw);
		max-width: 92vw;
		backdrop-filter: blur(6px);
	}
	.wp-popup-title {
		font-size: 0.85em;
		color: var(--fg-dim);
		margin-bottom: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.wp-popup-title .wp-num {
		min-width: 1.6rem;
		height: 1.6rem;
	}
	.wp-popup-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.45rem;
	}
	.wp-popup-btn {
		min-height: 40px;
		padding: 0.45rem 0.7rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--fg);
		font: inherit;
		cursor: pointer;
	}
	.wp-popup-btn:hover:not(:disabled) {
		background: var(--bg-elev, rgba(255, 255, 255, 0.06));
	}
	.wp-popup-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.wp-popup-del {
		color: var(--unsafe);
		border-color: rgba(239, 68, 68, 0.4);
	}
	.wp-popup-del:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.15);
	}
	.wp-popup-cancel {
		color: var(--fg-dim);
	}
	@media (max-width: 720px) {
		.wp-btn {
			min-width: 36px;
			min-height: 36px;
			font-size: 1em;
		}
		.wp-num {
			min-width: 1.7rem;
			height: 1.7rem;
		}
		.wp-chip {
			padding: 0.3rem 0.45rem;
			gap: 0.35rem;
		}
		.wp-popup-btn {
			min-height: 44px;
		}
	}
</style>
