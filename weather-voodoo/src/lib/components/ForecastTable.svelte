<script lang="ts">
	import type { DayOverride, DayKey, FusedHour, TripMode } from '$lib/types';
	import { aggregate3h } from '$lib/fusion';
	import { filterHoursForDay } from '$lib/time';
	import { hourTripScore, windowScoreAt } from '$lib/trip-score';
	import { minToHHMM } from '$lib/url-state';
	import ForecastRow from './ForecastRow.svelte';

	type Props = {
		allHours: FusedHour[];
		day: DayKey;
		mode: 'sea' | 'land';
		durationH: number;
		minMin: number;
		maxMin: number;
		override: DayOverride;
		topMinMin: number;
		topMaxMin: number;
		topDurationH: number;
		topMode: TripMode;
		onChangeOverride: (patch: Partial<DayOverride>) => void;
		onResetOverride: () => void;
		expanded: Set<string>;
		onToggleSlot: (slot: string) => void;
		todayIso: string;
	};

	let {
		allHours,
		day,
		mode,
		durationH,
		minMin,
		maxMin,
		override,
		topMinMin,
		topMaxMin,
		topDurationH,
		topMode,
		onChangeOverride,
		onResetOverride,
		expanded,
		onToggleSlot,
		todayIso
	}: Props = $props();

	const dayHours = $derived(filterHoursForDay(allHours, day, todayIso));
	const slots = $derived(aggregate3h(dayHours));
	const coastal = $derived(dayHours.some((h) => h.waveHsM != null));

	// Hours that can be a valid trip start (used for "best startable trip" slot score).
	const startBounds = $derived<[number, number]>([
		Math.ceil(minMin / 60),
		Math.floor(maxMin / 60)
	]);
	// Hours touched by any valid trip — extends back to floor(earliest) and forward by the
	// trip duration so the table colors every hour the user's trip could span, not just
	// the hours when a trip can begin.
	const coveredBounds = $derived<[number, number]>([
		Math.floor(minMin / 60),
		Math.ceil((maxMin + durationH * 60) / 60) - 1
	]);

	const hourScores = $derived.by(() => {
		const map = new Map<string, number | null>();
		const indexByTime = new Map<string, number>();
		for (let i = 0; i < allHours.length; i++) indexByTime.set(allHours[i].time, i);
		for (const h of dayHours) {
			const idx = indexByTime.get(h.time);
			if (idx == null) {
				map.set(h.time, null);
				continue;
			}
			const startHour = Number(h.time.slice(11, 13));
			const isValidStart = startHour >= startBounds[0] && startHour <= startBounds[1];
			map.set(
				h.time,
				isValidStart ? windowScoreAt(allHours, idx, durationH, mode) : hourTripScore(h, mode)
			);
		}
		return map;
	});

	const outsideInterval = $derived.by(() => {
		const s = new Set<string>();
		for (const h of dayHours) {
			const startHour = Number(h.time.slice(11, 13));
			if (startHour < coveredBounds[0] || startHour > coveredBounds[1]) s.add(h.time);
		}
		return s;
	});

	const outsideStartRange = $derived.by(() => {
		const s = new Set<string>();
		for (const h of dayHours) {
			const startHour = Number(h.time.slice(11, 13));
			if (startHour < startBounds[0] || startHour > startBounds[1]) s.add(h.time);
		}
		return s;
	});

	const overridden = $derived(
		override.min !== null || override.max !== null || override.durationH !== null || override.mode !== null
	);

	const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30);
	const DURATIONS = [1, 2, 3, 4, 6, 8, 12];

	function onMinChange(e: Event) {
		const v = Number((e.target as HTMLSelectElement).value);
		onChangeOverride({ min: v === topMinMin ? null : v });
	}
	function onMaxChange(e: Event) {
		const v = Number((e.target as HTMLSelectElement).value);
		onChangeOverride({ max: v === topMaxMin ? null : v });
	}
	function onDurationChange(e: Event) {
		const v = Number((e.target as HTMLSelectElement).value);
		onChangeOverride({ durationH: v === topDurationH ? null : v });
	}
	function onModeChange(e: Event) {
		const v = (e.target as HTMLSelectElement).value as TripMode;
		onChangeOverride({ mode: v === topMode ? null : v });
	}
</script>

<div class="interval-bar">
	<span class="muted" style="font-size: 0.85em; margin-right: 0.4rem;">For this day:</span>
	<label>
		<span class="muted">earliest</span>
		<select value={minMin} onchange={onMinChange}>
			{#each HALF_HOURS as m}
				<option value={m}>{minToHHMM(m)}</option>
			{/each}
		</select>
	</label>
	<label>
		<span class="muted">latest</span>
		<select value={maxMin} onchange={onMaxChange}>
			{#each HALF_HOURS as m}
				<option value={m}>{minToHHMM(m)}</option>
			{/each}
		</select>
	</label>
	<label>
		<span class="muted">duration</span>
		<select value={durationH} onchange={onDurationChange}>
			{#each DURATIONS as d}
				<option value={d}>{d} h</option>
			{/each}
		</select>
	</label>
	<label>
		<span class="muted">mode</span>
		<select value={override.mode ?? topMode} onchange={onModeChange}>
			<option value="auto">Auto ({mode})</option>
			<option value="sea">Sea</option>
			<option value="land">Land</option>
		</select>
	</label>
	{#if overridden}
		<button type="button" class="btn-ghost" style="padding: 0.3rem 0.6rem;" onclick={onResetOverride} title="Reset to top defaults">
			↻ reset
		</button>
		<span class="muted" style="font-size: 0.72em;">(custom — top default: {minToHHMM(topMinMin)}–{minToHHMM(topMaxMin)}, {topDurationH}h, {topMode})</span>
	{:else}
		<span class="muted" style="font-size: 0.72em;">(inherits top defaults)</span>
	{/if}
</div>

{#if dayHours.length === 0}
	<p class="muted">No forecast data for this day.</p>
{:else}
	<div class="forecast-scroll">
		<table class="forecast">
			<thead>
				<tr>
					<th>Time</th>
					<th></th>
					<th>Temp</th>
					<th>Wind / gust</th>
					<th>Rain / Pₚ</th>
					<th>Cloud</th>
					<th>Vis</th>
					<th>Wave</th>
				</tr>
			</thead>
			<tbody>
				{#each slots as slot}
					{@const key = slot.startHour.toString().padStart(2, '0')}
					<ForecastRow
						{slot}
						expanded={expanded.has(key)}
						onToggle={() => onToggleSlot(key)}
						{coastal}
						{mode}
						{hourScores}
						{outsideInterval}
						{outsideStartRange}
					/>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.interval-bar {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
		padding: 0.5rem 0;
		margin-bottom: 0.5rem;
		border-bottom: 1px solid var(--border);
	}
	.interval-bar select {
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.3rem 0.5rem;
		margin-left: 0.3rem;
		font: inherit;
	}
	@media (max-width: 720px) {
		.interval-bar {
			gap: 0.4rem;
			font-size: 0.88em;
		}
		.interval-bar select {
			padding: 0.25rem 0.4rem;
			margin-left: 0.2rem;
		}
	}
</style>
