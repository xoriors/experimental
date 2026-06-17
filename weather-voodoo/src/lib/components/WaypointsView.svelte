<script lang="ts">
	import { view, toggleExpanded, effectiveConfig, setDayOverride, resetDayOverride } from '$lib/state.svelte';
	import MapView from './MapView.svelte';
	import WindMapOverlay from './WindMapOverlay.svelte';
	import WindCompass from './WindCompass.svelte';
	import DayTabs from './DayTabs.svelte';
	import ForecastTable from './ForecastTable.svelte';
	import TripFinder from './TripFinder.svelte';
	import { filterHoursForDay, localIsoDate } from '$lib/time';
	import { t } from '$lib/i18n/index.svelte';
	import { chevronsForHour, pickNowHour, worstClass } from '$lib/wind-map';
	import type { RelativeWindClass } from '$lib/wind';
	import type { DaylightDay, FusedHour, LabeledPoint, DayKey, WindSample } from '$lib/types';

	type RouteMeta = {
		kind: 'waypoints';
		legCount: number;
		ferryLegs: number;
		seaLegs: number;
		trailLegs: number;
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
		windSamples: WindSample[];
	} | null>(null);

	let mapHour = $state<string | null>(null);

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
			`/api/multi-route?pts=${encodeURIComponent(ptsParam(pts))}&samples=3&days=4${landParam}`,
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
					windSamples?: WindSample[];
				};
				result = {
					hours: data.hours,
					timezone: data.timezone,
					daylight: data.daylight ?? [],
					polyline: data.polyline,
					route: data.route,
					windSamples: data.windSamples ?? []
				};
				mapHour = null;
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

	// Wind-overlay scrubber state. Chevrons are hidden while editing the
	// track (the polyline isn't real yet).
	const hourTimes = $derived(
		!editing ? (result?.windSamples?.[0]?.hours.map((h) => h.time) ?? []) : []
	);
	const nowTime = $derived(hourTimes.length > 0 ? pickNowHour(hourTimes) : null);
	const selectedTime = $derived(mapHour ?? nowTime ?? hourTimes[0] ?? '');
	const classLabelMap = $derived<Record<RelativeWindClass, string>>({
		head: t('wind.head'),
		'head-cross': t('wind.headCross'),
		cross: t('wind.cross'),
		'tail-cross': t('wind.tailCross'),
		tail: t('wind.tail')
	});
	const chevrons = $derived(
		!editing && result && selectedTime
			? chevronsForHour(result.windSamples, selectedTime, (c) => classLabelMap[c])
			: []
	);
	const verdictKeyMap = $derived<Record<RelativeWindClass, string>>({
		head: 'windMap.verdict.head',
		'head-cross': 'windMap.verdict.headCross',
		cross: 'windMap.verdict.cross',
		'tail-cross': 'windMap.verdict.tailCross',
		tail: 'windMap.verdict.tail'
	});
	const verdict = $derived.by(() => {
		const w = worstClass(chevrons);
		return w ? t(verdictKeyMap[w]) : undefined;
	});

	let selectedIdx: number | null = $state(null);
	let hoveredIdx: number | null = $state(null);
	// Marker to visually highlight on the map: selection wins over hover.
	const mapHighlightIdx = $derived(selectedIdx ?? hoveredIdx);

	let fullscreen = $state(false);
	function toggleFullscreen() {
		fullscreen = !fullscreen;
	}
	function onKey(e: KeyboardEvent) {
		if (fullscreen && e.key === 'Escape') fullscreen = false;
	}

	function onMapPick(p: { lat: number; lon: number }) {
		if (!editing) return; // Map only adds points while editing.
		if (selectedIdx !== null && draft[selectedIdx]) {
			// A point is selected — move it to the tapped location instead of
			// dropping a new one.
			const next = [...draft];
			next[selectedIdx] = { ...next[selectedIdx], lat: p.lat, lon: p.lon };
			draft = next;
			return;
		}
		draft = [...draft, { lat: p.lat, lon: p.lon, label: `Point ${draft.length + 1}` }];
	}
	function onMarkerTap(idx: number) {
		if (!editing) return;
		// Re-tapping the same marker closes the popup.
		selectedIdx = selectedIdx === idx ? null : idx;
	}
	function onMarkerDrag(idx: number, p: { lat: number; lon: number }) {
		if (!editing) return;
		const next = [...draft];
		if (!next[idx]) return;
		next[idx] = { ...next[idx], lat: p.lat, lon: p.lon };
		draft = next;
		// Hide the action popup once the user starts repositioning.
		if (selectedIdx === idx) selectedIdx = null;
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

	let showHelpDialog = $state(false);

	let compassVisible = $state(
		typeof localStorage !== 'undefined' ? localStorage.getItem('wx-compass') !== 'hidden' : true
	);
	function setCompassVisible(v: boolean) {
		compassVisible = v;
		if (typeof localStorage !== 'undefined') localStorage.setItem('wx-compass', v ? 'visible' : 'hidden');
	}

	function onDay(d: DayKey) {
		view.day = d;
	}

	void dayHours;
</script>

<svelte:window onkeydown={onKey} />

<div class="map-stage" class:fullscreen>
<div class="card">
	<div class="wp-header">
		<div class="muted wp-help">
			{#if editing}
				<span>{t('waypoints.editHelpShort')}</span>
				<button
					type="button"
					class="wp-help-btn"
					onclick={() => (showHelpDialog = true)}
					title={t('waypoints.editHelpTitle')}
					aria-label={t('waypoints.editHelpTitle')}
				>?</button>
			{:else}
				{@html t('waypoints.committedHelp')}
			{/if}
		</div>
		<div class="wp-cta">
			{#if editing}
				{#if view.waypoints.length > 0}
					<button type="button" class="btn-ghost wp-cancel" onclick={cancelEdit}>{t('waypoints.cancel')}</button>
				{/if}
				<button
					type="button"
					class="btn wp-done"
					onclick={commitEdit}
					disabled={draft.length < 2}
					title={draft.length < 2 ? t('waypoints.doneDisabledTitle') : t('waypoints.doneTitle')}
				>{t('waypoints.done')}</button>
			{:else}
				<button type="button" class="btn-ghost" onclick={startEdit}>{t('waypoints.change')}</button>
			{/if}
		</div>
	</div>

	{#if editing}
		{@const list = draft}
		{#if list.length > 0}
			<div class="wp-chips" role="list">
				{#each list as wp, i (i + '-' + wp.lat + ',' + wp.lon)}
					<button
						type="button"
						class="wp-chip wp-chip--clickable"
						class:wp-chip--selected={selectedIdx === i}
						class:wp-chip--hovered={hoveredIdx === i && selectedIdx !== i}
						role="listitem"
						title={t('waypoints.editPoint', { n: i + 1 })}
						aria-pressed={selectedIdx === i}
						onclick={() => onMarkerTap(i)}
						onmouseenter={() => (hoveredIdx = i)}
						onmouseleave={() => { if (hoveredIdx === i) hoveredIdx = null; }}
						onfocus={() => (hoveredIdx = i)}
						onblur={() => { if (hoveredIdx === i) hoveredIdx = null; }}
					>
						<span class="wp-num">{i + 1}</span>
						<span class="wp-chip-label">{t('waypoints.pointN', { n: i + 1 })}</span>
					</button>
				{/each}
			</div>
			<div class="wp-actions">
				<button type="button" class="btn-ghost" onclick={clearDraft}>{t('waypoints.clearAll')}</button>
				<span class="muted wp-count">{t(list.length === 1 ? 'waypoints.countOne' : 'waypoints.countMany', { n: list.length })}</span>
		</div>
		{:else}
			<div class="muted wp-hint">{t('waypoints.noneYet')}</div>
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
			{t('waypoints.computingLong')}
		</div>
	{:else if !editing && result?.route.kind === 'waypoints'}
		<div class="muted route-meta">
			🧭 {t('waypoints.trackLabel')}: <strong>{result.route.totalKm.toFixed(0)} km</strong>
			· {t(result.route.legCount === 1 ? 'waypoints.legsOne' : 'waypoints.legsMany', { n: result.route.legCount })}
			{#if result.route.ferryLegs > 0} · ⛴️ {t('waypoints.ferryLegs', { n: result.route.ferryLegs })}{/if}
			{#if result.route.seaLegs > 0} · ⚓ {t('waypoints.seaLegs', { n: result.route.seaLegs })}{/if}
			{#if result.route.trailLegs > 0} · 🥾 {t('waypoints.trailLegs', { n: result.route.trailLegs })}{/if}
			{#if result.route.straightLegs > 0} · 📐 {t('waypoints.straightLegs', { n: result.route.straightLegs })}{/if}
		</div>
	{:else if editing && draft.length >= 2}
		<div class="muted route-meta">
			{t('waypoints.straightPreview')}
		</div>
	{/if}

	{#if error}
		<p style="color: var(--unsafe);">{t('forecast.errorPrefix')}: {error}</p>
	{/if}
</div>

<div class="card map-card" style="padding: 0;">
	<MapView
		{markers}
		{polyline}
		onPick={onMapPick}
		onMarkerTap={editing ? onMarkerTap : undefined}
		onMarkerDrag={editing ? onMarkerDrag : undefined}
		draggableMarkers={editing}
		markerColor={editing ? '#ef4444' : '#38bdf8'}
		polylineColor={editing ? '#ef4444' : '#38bdf8'}
		highlightIdx={editing ? mapHighlightIdx : null}
		height={fullscreen ? '100%' : undefined}
		suppressAutoFit={editing}
		showUserLocation={chevrons.length > 0}
	/>
	{#if chevrons.length > 0 && hourTimes.length > 0 && selectedTime && compassVisible}
		<WindMapOverlay
			{hourTimes}
			{selectedTime}
			{nowTime}
			timezone={result?.timezone}
			{verdict}
			onSelect={(t) => (mapHour = t)}
		/>
	{/if}
	{#if !editing && loading && view.waypoints.length >= 2}
		<div class="map-loading" aria-live="polite">
			<span class="spinner" aria-hidden="true"></span>
			{t('route.computing')}
		</div>
	{/if}
	{#if chevrons.length > 0}
		<div class="wind-compass-anchor">
			{#if compassVisible}
				<WindCompass
					relWindDeg={chevrons[0].relWindDeg}
					windKn={chevrons[0].windKn}
					cls={chevrons[0].cls}
					classLabel={chevrons[0].classLabel}
					onHide={() => setCompassVisible(false)}
				/>
			{:else}
				<button
					type="button"
					class="wc-show-btn"
					onclick={() => setCompassVisible(true)}
					title={t('windMap.showCompass')}
					aria-label={t('windMap.showCompass')}
				>🧭</button>
			{/if}
		</div>
	{/if}
	{#if editing && selectedIdx !== null && draft[selectedIdx]}
		<div class="wp-popup" role="dialog" aria-label={t('waypoints.editAriaLabel')}>
			<div class="wp-popup-title">
				{t('waypoints.point')} <span class="wp-num">{selectedIdx + 1}</span>
			</div>
			<div class="wp-popup-hint">
				{@html t('waypoints.editHint')}
			</div>
			<div class="wp-popup-actions">
				<button
					type="button"
					class="wp-popup-btn"
					onclick={actionMoveBack}
					disabled={selectedIdx === 0}
				>{t('waypoints.moveBack')}</button>
				<button
					type="button"
					class="wp-popup-btn"
					onclick={actionMoveForward}
					disabled={selectedIdx === draft.length - 1}
				>{t('waypoints.moveForward')}</button>
				<button
					type="button"
					class="wp-popup-btn wp-popup-del"
					onclick={actionDelete}
				>{t('waypoints.delete')}</button>
				<button type="button" class="wp-popup-btn wp-popup-cancel" onclick={closeSelection}>{t('waypoints.cancel')}</button>
			</div>
		</div>
	{/if}
	<button
		type="button"
		class="map-fs-btn"
		onclick={toggleFullscreen}
		title={fullscreen ? t('map.exitFullscreenEsc') : t('map.fullscreen')}
		aria-label={fullscreen ? t('map.exitFullscreen') : t('map.fullscreen')}
	>{fullscreen ? '⤡' : '⤢'}</button>
</div>
</div>

{#if !editing && view.waypoints.length >= 2}
	{#if result}
		<TripFinder hours={result.hours} timezone={result.timezone} />
	{/if}
	<DayTabs day={view.day} onChange={onDay} />
	<div class="card">
		{#if loading}<p class="muted">{t('forecast.loading')}</p>{/if}
		{#if result}
			<p class="muted" style="margin-top: 0;">
				{t('waypoints.forecastCaption', { timezone: result.timezone })}
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

{#if showHelpDialog}
	<div
		class="wp-help-backdrop"
		role="presentation"
		onclick={() => (showHelpDialog = false)}
		onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') showHelpDialog = false; }}
	>
		<div
			class="wp-help-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="wp-help-title"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<h3 id="wp-help-title">{t('waypoints.editHelpTitle')}</h3>
			<div class="wp-help-body">{@html t('waypoints.editHelp')}</div>
			<button type="button" class="btn-ghost" onclick={() => (showHelpDialog = false)}>OK</button>
		</div>
	</div>
{/if}

<style>
	/* .map-stage + .map-fs-btn live in app.css */
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
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.wp-help-btn {
		all: unset;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		font-size: 13px;
		font-weight: 700;
		border-radius: 50%;
		border: 1.5px solid var(--fg-dim, #94a3b8);
		color: var(--fg-dim, #94a3b8);
		cursor: pointer;
		flex-shrink: 0;
	}
	.wp-help-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--fg);
		border-color: var(--fg);
	}
	.wp-help-btn:focus-visible {
		outline: 2px solid var(--good, #38bdf8);
		outline-offset: 2px;
	}
	.wp-help-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 1000;
	}
	.wp-help-dialog {
		background: var(--bg-elev, var(--bg));
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1rem 1.2rem;
		max-width: 24rem;
		width: 100%;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
	}
	.wp-help-dialog h3 {
		margin: 0 0 0.5rem 0;
		font-size: 1rem;
	}
	.wp-help-body {
		font-size: 0.9em;
		line-height: 1.5;
		margin-bottom: 0.8rem;
	}
	.wp-help-dialog .btn-ghost {
		padding: 0.35rem 0.8rem;
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
		gap: 0.4rem;
		padding: 0.3rem 0.65rem 0.3rem 0.35rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--bg);
		color: var(--fg);
		font: inherit;
		font-size: 0.85em;
	}
	.wp-chip--clickable {
		cursor: pointer;
	}
	.wp-chip--clickable:hover {
		background: var(--bg-elev, rgba(255, 255, 255, 0.05));
		border-color: #ef4444;
	}
	.wp-chip--selected {
		background: rgba(239, 68, 68, 0.18);
		border-color: #ef4444;
		box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.4) inset;
	}
	.wp-chip--hovered {
		background: rgba(250, 204, 21, 0.15);
		border-color: #facc15;
	}
	.wp-chip-label {
		font-weight: 600;
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
	.wind-compass-anchor {
		position: absolute;
		bottom: 14px;
		left: 14px;
		z-index: 12;
		pointer-events: auto;
	}
	.wc-show-btn {
		all: unset;
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 22px;
		background: rgba(15, 23, 42, 0.88);
		border: 1.5px solid rgba(148, 163, 184, 0.25);
		border-radius: 50%;
		cursor: pointer;
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
	}
	.wc-show-btn:hover {
		background: rgba(15, 23, 42, 0.95);
		border-color: rgba(255, 255, 255, 0.3);
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
	.wp-popup-hint {
		font-size: 0.85em;
		color: var(--fg-dim);
		line-height: 1.35;
		margin: -0.2rem 0 0.6rem;
		padding: 0.45rem 0.55rem;
		background: rgba(56, 189, 248, 0.12);
		border: 1px solid rgba(56, 189, 248, 0.35);
		border-radius: 8px;
	}
	.wp-popup-hint strong {
		color: var(--fg);
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
