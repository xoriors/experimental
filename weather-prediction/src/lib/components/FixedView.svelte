<script lang="ts">
	import { view, toggleExpanded } from '$lib/state.svelte';
	import PlaceSearch from './PlaceSearch.svelte';
	import MapView from './MapView.svelte';
	import DayTabs from './DayTabs.svelte';
	import ForecastTable from './ForecastTable.svelte';
	import TripFinder from './TripFinder.svelte';
	import { getCurrentPosition } from '$lib/client/geolocation';
	import { filterHoursForDay } from '$lib/time';
	import { mergeSinglePoint } from '$lib/fusion';
	import { resolveMode } from '$lib/trip-score';
	import type { FusedHour, ForecastHour, LabeledPoint, MarineHour, DayKey } from '$lib/types';

	let loading = $state(false);
	let error = $state<string | null>(null);
	let result = $state<{ hours: FusedHour[]; timezone: string } | null>(null);
	let owmAlerts = $state<{ event: string; description: string }[]>([]);
	let aqi = $state<number | null>(null);

	const markers = $derived(view.at ? [view.at] : []);

	$effect(() => {
		const at = view.at;
		if (!at) {
			result = null;
			return;
		}
		const ac = new AbortController();
		loading = true;
		error = null;

		Promise.all([
			fetch(`/api/forecast?lat=${at.lat.toFixed(4)}&lon=${at.lon.toFixed(4)}&days=3`, {
				signal: ac.signal
			}).then((r) => r.json() as Promise<{ timezone: string; hours: ForecastHour[] }>),
			fetch(`/api/marine?lat=${at.lat.toFixed(4)}&lon=${at.lon.toFixed(4)}&days=3`, {
				signal: ac.signal
			})
				.then((r) => r.json() as Promise<{ timezone: string; hours: MarineHour[] }>)
				.catch(() => ({ timezone: 'UTC', hours: [] as MarineHour[] }))
		])
			.then(([f, m]) => {
				result = {
					timezone: f.timezone,
					hours: mergeSinglePoint(f.hours, m.hours.length ? m.hours : null)
				};
			})
			.catch((e: unknown) => {
				if (e instanceof DOMException && e.name === 'AbortError') return;
				error = e instanceof Error ? e.message : 'Fetch failed';
			})
			.finally(() => {
				loading = false;
			});

		fetch(`/api/owm?lat=${at.lat.toFixed(4)}&lon=${at.lon.toFixed(4)}&kind=onecall`, {
			signal: ac.signal
		})
			.then((r) => r.json() as Promise<{ available: boolean; alerts?: { event: string; description: string }[] }>)
			.then((data) => {
				owmAlerts = data.available && data.alerts ? data.alerts : [];
			})
			.catch(() => {
				owmAlerts = [];
			});

		fetch(`/api/owm?lat=${at.lat.toFixed(4)}&lon=${at.lon.toFixed(4)}&kind=air`, { signal: ac.signal })
			.then((r) => r.json() as Promise<{ available: boolean; aqi?: number }>)
			.then((data) => {
				aqi = data.available && data.aqi !== undefined ? data.aqi : null;
			})
			.catch(() => {
				aqi = null;
			});

		return () => ac.abort();
	});

	const todayIso = $derived(new Date().toISOString().slice(0, 10));
	const hoursForDay = $derived(result ? filterHoursForDay(result.hours, view.day, todayIso) : []);
	const activeMode = $derived(result ? resolveMode(view.tripMode, result.hours) : 'land');

	function pick(p: LabeledPoint) {
		view.at = p;
	}
	function onMapPick(p: { lat: number; lon: number }) {
		view.at = { ...p };
	}
	function onDay(d: DayKey) {
		view.day = d;
	}

	let geolocating = $state(false);
	async function useMyLocation() {
		geolocating = true;
		error = null;
		try {
			const { lat, lon } = await getCurrentPosition();
			view.at = { lat, lon, label: 'My location' };
		} catch (e) {
			error = e instanceof Error ? e.message : 'Geolocation failed';
		} finally {
			geolocating = false;
		}
	}

	const aqiLabel: Record<number, string> = { 1: 'Good', 2: 'Fair', 3: 'Moderate', 4: 'Poor', 5: 'Very poor' };
</script>

<div class="card">
	<div class="row">
		<PlaceSearch placeholder="Search a place…" initial={view.at?.label} onSelect={pick} />
		<button class="btn-ghost" onclick={useMyLocation} disabled={geolocating}>
			{geolocating ? 'Locating…' : '📍 Use my location'}
		</button>
	</div>
	<div class="muted" style="margin-top: 0.5rem;">
		{#if view.at}
			<span>{view.at.label ?? `${view.at.lat.toFixed(3)}, ${view.at.lon.toFixed(3)}`}</span>
		{:else}
			<span>Pick a place or click on the map.</span>
		{/if}
	</div>
</div>

<div class="card" style="padding: 0;">
	<MapView {markers} onPick={onMapPick} />
</div>

{#if view.at}
	{#if result}
		<TripFinder hours={result.hours} timezone={result.timezone} defaultMode="land" />
	{/if}
	<DayTabs day={view.day} onChange={onDay} />
	<div class="card">
		{#if loading}<p class="muted">Loading forecast…</p>{/if}
		{#if error}<p style="color: var(--unsafe);">Error: {error}</p>{/if}

		{#if owmAlerts.length}
			<div style="border: 1px solid var(--unsafe); background: rgba(239,68,68,0.08); padding: 0.5rem 0.75rem; border-radius: 6px; margin-bottom: 0.75rem;">
				<strong>Alerts:</strong>
				<ul style="margin: 0.3rem 0 0 1rem;">
					{#each owmAlerts as a}<li>{a.event}</li>{/each}
				</ul>
			</div>
		{/if}

		{#if aqi != null}
			<p class="muted" style="margin-top: 0;">Air quality (OpenWeather): {aqi} ({aqiLabel[aqi] ?? 'unknown'})</p>
		{/if}

		{#if result}
			<p class="muted" style="margin-top: 0;">
				Forecast in {result.timezone}. 3h blocks aggregate worst conditions in the period. Click a row to expand hourly.
			</p>
			<ForecastTable
				hours={hoursForDay}
				expanded={view.expanded}
				onToggleSlot={toggleExpanded}
				mode={activeMode}
			/>
		{/if}
	</div>
{/if}
