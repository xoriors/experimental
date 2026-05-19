<script lang="ts">
	import { view } from '$lib/state.svelte';
	import { findBestWindows, resolveMode, scoreToCss, type TripWindow } from '$lib/trip-score';
	import { filterHoursForDay } from '$lib/time';
	import { round1 } from '$lib/units';
	import type { DayKey, FusedHour, TripMode } from '$lib/types';

	type Props = {
		hours: FusedHour[];
		timezone: string;
		defaultMode?: TripMode;
	};

	let { hours, timezone, defaultMode }: Props = $props();

	const activeMode = $derived(resolveMode(view.tripMode, hours));
	const allWindows = $derived(
		findBestWindows(hours, view.tripDurationH, activeMode, view.tripMinHour)
	);
	const bestOverall = $derived<TripWindow | undefined>(allWindows[0]);

	const todayIso = $derived(new Date().toISOString().slice(0, 10));

	type DayLabel = { key: DayKey; label: string };
	const DAYS: DayLabel[] = [
		{ key: 'today', label: 'Today' },
		{ key: 'tomorrow', label: 'Tomorrow' },
		{ key: 'd2', label: 'Day after' }
	];

	const bestPerDay = $derived(
		DAYS.map(({ key, label }) => {
			const dayHours = filterHoursForDay(hours, key, todayIso);
			const wins = findBestWindows(dayHours, view.tripDurationH, activeMode, view.tripMinHour);
			return { key, label, window: wins[0] ?? null };
		})
	);

	const DURATIONS = [1, 2, 3, 4, 6, 8, 12];
	const MIN_HOURS = Array.from({ length: 24 }, (_, i) => i);

	function onModeChange(e: Event) {
		view.tripMode = (e.target as HTMLSelectElement).value as TripMode;
	}
	function onDurationChange(e: Event) {
		view.tripDurationH = Number((e.target as HTMLSelectElement).value);
	}
	function onMinHourChange(e: Event) {
		view.tripMinHour = Number((e.target as HTMLSelectElement).value);
	}

	function pad2(n: number): string {
		return n.toString().padStart(2, '0');
	}

	function formatDay(iso: string): string {
		const date = iso.slice(0, 10);
		const today = new Date().toISOString().slice(0, 10);
		const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
		const d2 = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
		if (date === today) return 'Today';
		if (date === tomorrow) return 'Tomorrow';
		if (date === d2) return 'Day after';
		return date;
	}

	function formatRange(w: { startTime: string; durationH: number }): string {
		const start = w.startTime.slice(11, 16);
		const startHr = Number(start.slice(0, 2));
		const endHr = (startHr + w.durationH) % 24;
		const end = endHr.toString().padStart(2, '0') + ':' + start.slice(3);
		return `${start} → ${end}`;
	}

	function summariseConditions(slice: FusedHour[]): string {
		const maxWind = Math.max(...slice.map((h) => h.windKn));
		const maxGust = Math.max(...slice.map((h) => h.gustKn));
		const waves = slice.map((h) => h.waveHsM).filter((v): v is number => v != null);
		const maxWave = waves.length ? Math.max(...waves) : null;
		const maxRain = Math.max(...slice.map((h) => h.precipMmH));
		const minVis = Math.min(...slice.map((h) => h.visKm));
		const parts: string[] = [];
		parts.push(`wind ${round1(maxWind)}/${round1(maxGust)} kn`);
		if (maxWave != null) parts.push(`waves ${round1(maxWave)} m`);
		parts.push(`rain ${round1(maxRain)} mm/h`);
		parts.push(`vis ${round1(minVis)} km`);
		return parts.join(' · ');
	}

	const bestCss = $derived(bestOverall ? scoreToCss(bestOverall.score) : { bg: '', border: 'transparent' });
</script>

<div class="card trip-finder">
	<div class="row" style="gap: 1rem; align-items: center;">
		<label>
			<span class="muted">Duration</span>
			<select onchange={onDurationChange} value={view.tripDurationH}>
				{#each DURATIONS as d}
					<option value={d}>{d} h</option>
				{/each}
			</select>
		</label>
		<label>
			<span class="muted">Mode</span>
			<select onchange={onModeChange} value={view.tripMode}>
				<option value="auto">Auto ({activeMode})</option>
				<option value="sea">Sea</option>
				<option value="land">Land</option>
			</select>
		</label>
		<label>
			<span class="muted">Earliest start</span>
			<select onchange={onMinHourChange} value={view.tripMinHour}>
				{#each MIN_HOURS as h}
					<option value={h}>{pad2(h)}:00</option>
				{/each}
			</select>
		</label>
		<div class="legend" title="Score 0 (worst) → 100 (best)">
			<span class="legend-bar"></span>
			<span class="muted" style="font-size: 0.75em;">0 → 100</span>
		</div>
	</div>

	{#if bestOverall}
		<div class="best-pick" style="border-left: 4px solid {bestCss.border}; background: {bestCss.bg};">
			<div style="font-size: 1.1em;">
				<strong>★ Best across 3 days:</strong> {formatDay(bestOverall.startTime)} {bestOverall.startTime.slice(11, 16)} —
				<strong>{bestOverall.score}/100</strong>
				<span class="muted">(avg {bestOverall.avgScore})</span>
			</div>
			<div class="muted" style="margin-top: 0.25rem;">
				{view.tripDurationH}h window: {formatRange(bestOverall)} · {summariseConditions(bestOverall.hours)}
			</div>
		</div>

		<div style="margin-top: 0.6rem;">
			<div class="muted" style="font-size: 0.85em; margin-bottom: 0.3rem;">Best window each day:</div>
			<ul class="window-list">
				{#each bestPerDay as entry}
					{@const w = entry.window}
					{@const css = w ? scoreToCss(w.score) : { bg: 'transparent', border: 'transparent' }}
					<li style="border-left: 3px solid {css.border}; background: {css.bg};">
						<span class="day-label">{entry.label}</span>
						{#if w}
							<span class="time-cell">{w.startTime.slice(11, 16)}</span>
							<span class="range-cell">{formatRange(w)}</span>
							<strong class="score-cell">{w.score}</strong>
							<span class="muted avg-cell">avg {w.avgScore}</span>
							<span class="muted conditions">{summariseConditions(w.hours)}</span>
						{:else}
							<span class="muted">no window fits</span>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<p class="muted">Not enough forecast data to find a window.</p>
	{/if}

	<p class="muted" style="font-size: 0.75em; margin-top: 0.5rem;">
		Score combines {activeMode === 'sea' ? 'ferry/boat + kayaking' : 'sightseeing + hiking + photography'}
		activity verdicts across each hour of the trip. Window score = worst-hour score (chain-as-strong-as-weakest-link).
		Times in {timezone}.
	</p>
</div>

<style>
	.trip-finder select {
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.4rem 0.5rem;
		margin-left: 0.4rem;
		font: inherit;
	}
	.best-pick {
		margin-top: 0.75rem;
		padding: 0.6rem 0.75rem;
		border-radius: 6px;
	}
	.window-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.window-list li {
		padding: 0.4rem 0.6rem;
		border-radius: 4px;
		font-variant-numeric: tabular-nums;
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.day-label {
		display: inline-block;
		min-width: 7rem;
		font-weight: 600;
	}
	.time-cell {
		display: inline-block;
		min-width: 3.4rem;
	}
	.range-cell {
		display: inline-block;
		min-width: 7rem;
	}
	.score-cell {
		display: inline-block;
		min-width: 2.4rem;
		text-align: right;
	}
	.avg-cell {
		display: inline-block;
		min-width: 4rem;
	}
	.conditions {
		flex: 1;
		font-size: 0.85em;
		min-width: 16rem;
	}
	.legend {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		margin-left: auto;
	}
	.legend-bar {
		display: inline-block;
		width: 80px;
		height: 8px;
		border-radius: 4px;
		background: linear-gradient(
			to right,
			hsl(0, 72%, 48%),
			hsl(60, 72%, 48%),
			hsl(120, 72%, 48%)
		);
	}
</style>
