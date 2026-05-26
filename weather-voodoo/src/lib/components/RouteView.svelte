<script lang="ts">
	import { view, toggleExpanded, effectiveConfig, setDayOverride, resetDayOverride } from '$lib/state.svelte';
	import PlaceSearch from './PlaceSearch.svelte';
	import PlacesChips from './PlacesChips.svelte';
	import MapView from './MapView.svelte';
	import WindMapOverlay from './WindMapOverlay.svelte';
	import WindCompass from './WindCompass.svelte';
	import DayTabs from './DayTabs.svelte';
	import ForecastTable from './ForecastTable.svelte';
	import TripFinder from './TripFinder.svelte';
	import { filterHoursForDay, localIsoDate } from '$lib/time';
	import { addRecent } from '$lib/client/recentPlaces.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { chevronsForHour, pickNowHour, worstClass } from '$lib/wind-map';
	import type { RelativeWindClass } from '$lib/wind';
	import type { DaylightDay, FusedHour, LabeledPoint, DayKey, WindSample } from '$lib/types';

	let loading = $state(false);
	let error = $state<string | null>(null);
	type RouteMeta =
		| { kind: 'ferry'; lengthKm: number; wayCount: number; originSnapKm: number; destinationSnapKm: number }
		| { kind: 'sea'; lengthKm: number; greatCircleKm: number; detourRatio: number }
		| { kind: 'trail'; lengthKm: number; wayCount: number; hikeWayCount: number; bikeWayCount: number; originSnapKm: number; destinationSnapKm: number }
		| { kind: 'straight'; ferryFallback?: string; ferryDetail?: string; trailFallback?: string; trailDetail?: string };
	let result = $state<{
		hours: FusedHour[];
		timezone: string;
		daylight: DaylightDay[];
		polyline: { lat: number; lon: number }[];
		route: RouteMeta;
		windSamples: WindSample[];
	} | null>(null);

	// Currently-selected hour for the on-map wind chevron overlay. null = auto
	// (use the first hour >= now). Resets when a new route loads.
	let mapHour = $state<string | null>(null);

	const markers = $derived(
		[view.from, view.to].filter((m): m is LabeledPoint => m !== null)
	);

	const polyline = $derived(
		// While the route is being computed, don't draw a line — a straight-line
		// placeholder is misleading because the actual path may be very different.
		loading ? undefined : (result?.polyline ?? undefined)
	);

	$effect(() => {
		const from = view.from;
		const to = view.to;
		if (!from || !to) {
			result = null;
			return;
		}
		const ac = new AbortController();
		loading = true;
		error = null;
		const landParam = view.tripMode === 'land' ? '&land=1' : '';
		fetch(
			`/api/route?from=${from.lat.toFixed(4)},${from.lon.toFixed(4)}&to=${to.lat.toFixed(4)},${to.lon.toFixed(4)}&samples=3&days=3${landParam}`,
			{ signal: ac.signal }
		)
			.then(async (r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				const data = (await r.json()) as {
					hours: FusedHour[];
					timezone: string;
					daylight?: DaylightDay[];
					polyline?: { lat: number; lon: number }[];
					route?: RouteMeta;
					windSamples?: WindSample[];
				};
				result = {
					hours: data.hours,
					timezone: data.timezone,
					daylight: data.daylight ?? [],
					polyline: data.polyline ?? [
						{ lat: from.lat, lon: from.lon },
						{ lat: to.lat, lon: to.lon }
					],
					route: data.route ?? { kind: 'straight' },
					windSamples: data.windSamples ?? []
				};
				// Reset scrubber to "now" whenever a new route comes in.
				mapHour = null;
			})
			.catch((e: unknown) => {
				if (e instanceof DOMException && e.name === 'AbortError') return;
				error = e instanceof Error ? e.message : t('forecast.fetchFailed');
			})
			.finally(() => {
				loading = false;
			});
		return () => ac.abort();
	});

	const todayIso = $derived(localIsoDate());
	const eff = $derived(effectiveConfig(view.day));
	const dayHours = $derived(
		result ? filterHoursForDay(result.hours, view.day, todayIso) : []
	);
	const activeMode = $derived(eff.mode);

	// Wind-overlay scrubber state.
	const hourTimes = $derived(result?.windSamples?.[0]?.hours.map((h) => h.time) ?? []);
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
		result && selectedTime
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

	let lastFocused: 'from' | 'to' | null = $state(null);

	function pickFrom(p: LabeledPoint) {
		view.from = p;
		if (p.label) addRecent(p);
	}
	function pickTo(p: LabeledPoint) {
		view.to = p;
		if (p.label) addRecent(p);
	}
	function pickFromChip(p: LabeledPoint) {
		if (lastFocused === 'from') {
			pickFrom(p);
		} else if (lastFocused === 'to') {
			pickTo(p);
		} else if (!view.from) {
			pickFrom(p);
		} else if (!view.to) {
			pickTo(p);
		} else {
			pickTo(p);
		}
	}
	function onMapPick(p: { lat: number; lon: number }) {
		if (!view.from) view.from = { ...p };
		else if (!view.to) view.to = { ...p };
		else view.to = { ...p };
	}
	function onDay(d: DayKey) {
		view.day = d;
	}

	let compassVisible = $state(
		typeof localStorage !== 'undefined' ? localStorage.getItem('wx-compass') !== 'hidden' : true
	);
	function setCompassVisible(v: boolean) {
		compassVisible = v;
		if (typeof localStorage !== 'undefined') localStorage.setItem('wx-compass', v ? 'visible' : 'hidden');
	}

	let fullscreen = $state(false);
	function toggleFullscreen() {
		fullscreen = !fullscreen;
	}
	function onKey(e: KeyboardEvent) {
		if (fullscreen && e.key === 'Escape') fullscreen = false;
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="map-stage" class:fullscreen>
<div class="card">
	<div class="row">
		<PlaceSearch
			placeholder={t('place.fromPlaceholder')}
			initial={view.from?.label}
			onSelect={pickFrom}
			onFocus={() => (lastFocused = 'from')}
		/>
		<PlaceSearch
			placeholder={t('place.toPlaceholder')}
			initial={view.to?.label}
			onSelect={pickTo}
			onFocus={() => (lastFocused = 'to')}
		/>
	</div>
	<PlacesChips onPick={pickFromChip} />
	<div class="muted" style="margin-top: 0.5rem;">
		{#if view.from}<span>{t('place.fromPrefix')}: {view.from.label ?? `${view.from.lat.toFixed(3)}, ${view.from.lon.toFixed(3)}`}</span>{/if}
		{#if view.from && view.to}<span> · </span>{/if}
		{#if view.to}<span>{t('place.toPrefix')}: {view.to.label ?? `${view.to.lat.toFixed(3)}, ${view.to.lon.toFixed(3)}`}</span>{/if}
		{#if !view.from && !view.to}<span>{t('place.tapToDropPin')}</span>{/if}
	</div>
	{#if loading && view.from && view.to}
		<div class="muted route-meta route-loading">
			<span class="spinner" aria-hidden="true"></span>
			{t('route.computingLong')}
		</div>
	{:else if result?.route.kind === 'ferry'}
		<div class="muted route-meta">
			{t('route.ferryPrefix')} <strong>{result.route.lengthKm.toFixed(0)} km</strong>
			<span title={t('route.waysTitle')}>{t('route.waysSuffix', { n: result.route.wayCount })}</span>
		</div>
	{:else if result?.route.kind === 'trail'}
		<div class="muted route-meta">
			{t('route.trailPrefix')} <strong>{result.route.lengthKm.toFixed(0)} km</strong>
			{t('route.trailWaysSuffix', { hike: result.route.hikeWayCount, bike: result.route.bikeWayCount })}
		</div>
	{:else if result?.route.kind === 'sea'}
		<div class="muted route-meta">
			{t('route.seaPrefix')} <strong>{result.route.lengthKm.toFixed(0)} km</strong>
			<span title={t('route.detourTitle')}>(×{result.route.detourRatio.toFixed(2)} {t('route.greatCircleSuffix')})</span>
		</div>
	{:else if view.from && view.to && result}
		<div class="muted route-meta">
			{t('route.straight')}{#if result.route.kind === 'straight' && result.route.ferryFallback} ({t('route.ferryLabel')}: {result.route.ferryFallback}{#if result.route.ferryDetail} · {result.route.ferryDetail}{/if}){/if}{#if result.route.kind === 'straight' && result.route.trailFallback} ({t('route.trailLabel')}: {result.route.trailFallback}{#if result.route.trailDetail} · {result.route.trailDetail}{/if}){/if} {t('route.straightHint')}
		</div>
	{/if}
</div>

<div class="card map-card" class:loading-overlay={loading} style="padding: 0;">
	<MapView
		{markers}
		{polyline}
		onPick={onMapPick}
		height={fullscreen ? '100%' : undefined}
		showUserLocation={chevrons.length > 0}
	/>
	{#if chevrons.length > 0 && hourTimes.length > 0 && selectedTime}
		<WindMapOverlay
			{hourTimes}
			{selectedTime}
			{nowTime}
			timezone={result?.timezone}
			{verdict}
			onSelect={(t) => (mapHour = t)}
		/>
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
	{#if loading && view.from && view.to}
		<div class="map-loading" aria-live="polite">
			<span class="spinner" aria-hidden="true"></span>
			{t('route.computing')}
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

{#if view.from && view.to}
	{#if result}
		<TripFinder hours={result.hours} timezone={result.timezone} />
	{/if}
	<DayTabs day={view.day} onChange={onDay} />
	<div class="card">
		{#if loading}<p class="muted">{t('forecast.loading')}</p>{/if}
		{#if error}<p style="color: var(--unsafe);">{t('forecast.errorPrefix')}: {error}</p>{/if}
		{#if result}
			<p class="muted" style="margin-top: 0;">
				{t('forecast.routeCaption', { timezone: result.timezone })}
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
	.route-meta {
		margin-top: 0.4rem;
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
	.wind-compass-anchor {
		position: absolute;
		bottom: 14px;
		left: 14px;
		z-index: 12;
		pointer-events: auto;
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
</style>
