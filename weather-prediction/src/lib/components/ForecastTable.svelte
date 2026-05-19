<script lang="ts">
	import type { DayInterval, DayKey, FusedHour } from '$lib/types';
	import { aggregate3h } from '$lib/fusion';
	import { filterHoursForDay } from '$lib/time';
	import { windowScoreAt } from '$lib/trip-score';
	import ForecastRow from './ForecastRow.svelte';

	type Props = {
		allHours: FusedHour[];
		day: DayKey;
		mode: 'sea' | 'land';
		durationH: number;
		min: number;
		max: number;
		override: DayInterval;
		topMin: number;
		topMax: number;
		onChangeInterval: (min: number | null, max: number | null) => void;
		expanded: Set<string>;
		onToggleSlot: (slot: string) => void;
		todayIso: string;
	};

	let {
		allHours,
		day,
		mode,
		durationH,
		min,
		max,
		override,
		topMin,
		topMax,
		onChangeInterval,
		expanded,
		onToggleSlot,
		todayIso
	}: Props = $props();

	const dayHours = $derived(filterHoursForDay(allHours, day, todayIso));
	const slots = $derived(aggregate3h(dayHours));
	const coastal = $derived(dayHours.some((h) => h.waveHsM != null));

	const hourScores = $derived.by(() => {
		const map = new Map<string, number | null>();
		const indexByTime = new Map<string, number>();
		for (let i = 0; i < allHours.length; i++) indexByTime.set(allHours[i].time, i);
		for (const h of dayHours) {
			const startHour = Number(h.time.slice(11, 13));
			const inInterval = startHour >= min && startHour <= max;
			if (!inInterval) {
				map.set(h.time, null);
				continue;
			}
			const idx = indexByTime.get(h.time);
			if (idx == null) {
				map.set(h.time, null);
				continue;
			}
			map.set(h.time, windowScoreAt(allHours, idx, durationH, mode));
		}
		return map;
	});

	const overridden = $derived(override.min !== null || override.max !== null);

	const HOURS = Array.from({ length: 24 }, (_, i) => i);

	function pad2(n: number): string {
		return n.toString().padStart(2, '0');
	}

	function onMinChange(e: Event) {
		const v = Number((e.target as HTMLSelectElement).value);
		onChangeInterval(v === topMin ? null : v, override.max);
	}

	function onMaxChange(e: Event) {
		const v = Number((e.target as HTMLSelectElement).value);
		onChangeInterval(override.min, v === topMax ? null : v);
	}

	function onReset() {
		onChangeInterval(null, null);
	}
</script>

<div class="interval-bar">
	<span class="muted" style="font-size: 0.85em;">Start window for this day:</span>
	<label>
		<span class="muted">from</span>
		<select value={min} onchange={onMinChange}>
			{#each HOURS as h}
				<option value={h}>{pad2(h)}:00</option>
			{/each}
		</select>
	</label>
	<label>
		<span class="muted">to</span>
		<select value={max} onchange={onMaxChange}>
			{#each HOURS as h}
				<option value={h}>{pad2(h)}:00</option>
			{/each}
		</select>
	</label>
	{#if overridden}
		<button type="button" class="btn-ghost" style="padding: 0.3rem 0.6rem;" onclick={onReset} title="Reset to top defaults">
			↻ reset
		</button>
		<span class="muted" style="font-size: 0.75em;">(overrides top default {pad2(topMin)}:00–{pad2(topMax)}:00)</span>
	{:else}
		<span class="muted" style="font-size: 0.75em;">(inherits top default)</span>
	{/if}
</div>

{#if dayHours.length === 0}
	<p class="muted">No forecast data for this day.</p>
{:else}
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
				/>
			{/each}
		</tbody>
	</table>
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
</style>
