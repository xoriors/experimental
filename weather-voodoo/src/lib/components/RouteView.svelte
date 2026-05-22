<script lang="ts">
	import { view, toggleExpanded, effectiveConfig, setDayOverride, resetDayOverride } from '$lib/state.svelte';
	import PlaceSearch from './PlaceSearch.svelte';
	import PlacesChips from './PlacesChips.svelte';
	import MapView from './MapView.svelte';
	import DayTabs from './DayTabs.svelte';
	import ForecastTable from './ForecastTable.svelte';
	import TripFinder from './TripFinder.svelte';
	import { filterHoursForDay, localIsoDate } from '$lib/time';
	import { addRecent } from '$lib/client/recentPlaces.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import type { DaylightDay, FusedHour, LabeledPoint, DayKey } from '$lib/types';

	let loading = $state(false);
	let error = $state<string | null>(null);
	type RouteMeta =
		| { kind: 'ferry'; lengthKm: number; wayCount: number; originSnapKm: number; destinationSnapKm: number }
		| { kind: 'sea'; lengthKm: number; greatCircleKm: number; detourRatio: number }
		| { kind: 'straight'; ferryFallback?: string; ferryDetail?: string };
	let result = $state<{
		hours: FusedHour[];
		timezone: string;
		daylight: DaylightDay[];
		polyline: { lat: number; lon: number }[];
		route: RouteMeta;
	} | null>(null);

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
				};
				result = {
					hours: data.hours,
					timezone: data.timezone,
					daylight: data.daylight ?? [],
					polyline: data.polyline ?? [
						{ lat: from.lat, lon: from.lon },
						{ lat: to.lat, lon: to.lon }
					],
					route: data.route ?? { kind: 'straight' }
				};
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
	{:else if result?.route.kind === 'sea'}
		<div class="muted route-meta">
			{t('route.seaPrefix')} <strong>{result.route.lengthKm.toFixed(0)} km</strong>
			<span title={t('route.detourTitle')}>(×{result.route.detourRatio.toFixed(2)} {t('route.greatCircleSuffix')})</span>
		</div>
	{:else if view.from && view.to && result}
		<div class="muted route-meta">
			{t('route.straight')}{#if result.route.kind === 'straight' && result.route.ferryFallback} ({t('route.ferryLabel')}: {result.route.ferryFallback}{#if result.route.ferryDetail} · {result.route.ferryDetail}{/if}){/if} {t('route.straightHint')}
		</div>
	{/if}
</div>

<div class="card map-card" class:loading-overlay={loading} style="padding: 0;">
	<MapView {markers} {polyline} onPick={onMapPick} height={fullscreen ? '100%' : undefined} />
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
