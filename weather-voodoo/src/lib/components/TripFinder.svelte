<script lang="ts">
	import { tick } from 'svelte';
	import { view, effectiveConfig } from '$lib/state.svelte';
	import { findBestWindows, resolveMode, scoreToCss, type TripWindow } from '$lib/trip-score';
	import { filterHoursForDay } from '$lib/time';
	import { minToHHMM } from '$lib/url-state';
	import { round1 } from '$lib/units';
	import type { DayKey, FusedHour, TripMode } from '$lib/types';

	type Props = {
		hours: FusedHour[];
		timezone: string;
		defaultMode?: TripMode;
	};

	let { hours, timezone, defaultMode }: Props = $props();

	function toHourBounds(minMin: number, maxMin: number): [number, number] {
		return [Math.ceil(minMin / 60), Math.floor(maxMin / 60)];
	}

	const activeMode = $derived(resolveMode(view.tripMode, hours));
	const topBounds = $derived(toHourBounds(view.tripMinMin, view.tripMaxMin));
	const allWindows = $derived(
		findBestWindows(hours, view.tripDurationH, activeMode, topBounds[0], topBounds[1])
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
			const eff = effectiveConfig(key);
			const mode = resolveMode(eff.mode, dayHours);
			const [minHr, maxHr] = toHourBounds(eff.min, eff.max);
			const wins = findBestWindows(dayHours, eff.durationH, mode, minHr, maxHr);
			return { key, label, window: wins[0] ?? null, eff, mode };
		})
	);

	const DURATIONS = [1, 2, 3, 4, 6, 8, 12];
	const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30);

	function onModeChange(e: Event) {
		view.tripMode = (e.target as HTMLSelectElement).value as TripMode;
	}
	function onDurationChange(e: Event) {
		view.tripDurationH = Number((e.target as HTMLSelectElement).value);
	}
	function onMinChange(e: Event) {
		view.tripMinMin = Number((e.target as HTMLSelectElement).value);
	}
	function onMaxChange(e: Event) {
		view.tripMaxMin = Number((e.target as HTMLSelectElement).value);
	}

	function nowMinutesInForecastTz(): number {
		const parts = new Intl.DateTimeFormat('en-GB', {
			timeZone: timezone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).formatToParts(new Date());
		const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
		const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
		return h * 60 + m;
	}

	function nearestHalfHour(min: number): number {
		return Math.max(0, Math.min(1410, Math.round(min / 30) * 30));
	}

	function setMinNow() {
		view.tripMinMin = nearestHalfHour(nowMinutesInForecastTz());
	}
	function setMaxNow() {
		view.tripMaxMin = nearestHalfHour(nowMinutesInForecastTz());
	}

	function pad2(n: number): string {
		return n.toString().padStart(2, '0');
	}

	async function selectWindow(w: TripWindow, dur: number) {
		const date = w.startTime.slice(0, 10);
		const todayDate = todayIso;
		const tomorrowDate = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
		if (date === todayDate) view.day = 'today';
		else if (date === tomorrowDate) view.day = 'tomorrow';
		else view.day = 'd2';

		view.highlight = w.startTime;

		const slotStart = Math.floor(w.startHour / 3) * 3;
		const slotKey = pad2(slotStart);
		const next = new Set(view.expanded);
		next.add(slotKey);
		view.expanded = next;
		void dur;

		await tick();
		await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
		if (typeof document === 'undefined') return;
		const sel = `[data-hour-time="${CSS.escape(w.startTime)}"]`;
		const el = document.querySelector(sel) ?? document.querySelector(`[data-slot-start="${slotKey}"]`);
		if (el && 'scrollIntoView' in el) {
			(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
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
			<span class="muted">Earliest start</span>
			<select onchange={onMinChange} value={view.tripMinMin}>
				{#each HALF_HOURS as m}
					<option value={m}>{minToHHMM(m)}</option>
				{/each}
			</select>
			<button type="button" class="now-btn" onclick={setMinNow} title="Set to nearest half-hour to now">Now</button>
		</label>
		<label>
			<span class="muted">Latest start</span>
			<select onchange={onMaxChange} value={view.tripMaxMin}>
				{#each HALF_HOURS as m}
					<option value={m}>{minToHHMM(m)}</option>
				{/each}
			</select>
			<button type="button" class="now-btn" onclick={setMaxNow} title="Set to nearest half-hour to now">Now</button>
		</label>
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
		<div class="legend" title="Score 0 (worst) → 100 (best)">
			<span class="legend-bar"></span>
			<span class="muted" style="font-size: 0.75em;">0 → 100</span>
		</div>
	</div>

	{#if bestOverall}
		<button
			type="button"
			class="best-pick"
			style="border-left: 4px solid {bestCss.border}; background: {bestCss.bg};"
			onclick={() => selectWindow(bestOverall, view.tripDurationH)}
			title="Click to highlight in the table below"
		>
			<div style="font-size: 1.1em;">
				<strong>★ Best across 3 days:</strong> {formatDay(bestOverall.startTime)} {bestOverall.startTime.slice(11, 16)} —
				<strong>{bestOverall.score}/100</strong>
				<span class="muted">(avg {bestOverall.avgScore})</span>
			</div>
			<div class="muted" style="margin-top: 0.25rem;">
				{view.tripDurationH}h window: {formatRange(bestOverall)} · {summariseConditions(bestOverall.hours)}
			</div>
		</button>

		<div style="margin-top: 0.6rem;">
			<div class="muted" style="font-size: 0.85em; margin-bottom: 0.3rem;">Best window each day:</div>
			<ul class="window-list">
				{#each bestPerDay as entry}
					{@const w = entry.window}
					{@const css = w ? scoreToCss(w.score) : { bg: 'transparent', border: 'transparent' }}
					<li>
						{#if w}
							<button
								type="button"
								class="window-row"
								style="border-left: 3px solid {css.border}; background: {css.bg};"
								onclick={() => selectWindow(w, entry.eff.durationH)}
								title="Click to highlight in the table below"
							>
								<span class="day-label">{entry.label}</span>
								<span class="time-cell">{w.startTime.slice(11, 16)}</span>
								<span class="range-cell">{formatRange(w)}</span>
								<strong class="score-cell">{w.score}</strong>
								<span class="muted avg-cell">avg {w.avgScore}</span>
								<span class="muted conditions">{summariseConditions(w.hours)}</span>
								{#if entry.eff.durationH !== view.tripDurationH || entry.eff.mode !== view.tripMode}
									<span class="muted override-badge">{entry.eff.durationH}h · {entry.mode}</span>
								{/if}
							</button>
						{:else}
							<div class="window-row" style="opacity: 0.6;">
								<span class="day-label">{entry.label}</span>
								<span class="muted">no window fits</span>
							</div>
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
	.now-btn {
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
		margin-left: 0.3rem;
		font: inherit;
		font-size: 0.85em;
		cursor: pointer;
	}
	.now-btn:hover {
		background: var(--bg-elevated, rgba(255, 255, 255, 0.05));
	}
	.best-pick {
		display: block;
		width: 100%;
		text-align: left;
		margin-top: 0.75rem;
		padding: 0.6rem 0.75rem;
		border-radius: 6px;
		border: none;
		color: var(--fg);
		cursor: pointer;
		font: inherit;
	}
	.best-pick:hover {
		filter: brightness(1.2);
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
		padding: 0;
	}
	.window-row {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		flex-wrap: wrap;
		width: 100%;
		padding: 0.4rem 0.6rem;
		border-radius: 4px;
		font-variant-numeric: tabular-nums;
		border: none;
		color: var(--fg);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.window-row:hover {
		filter: brightness(1.2);
	}
	.day-label {
		display: inline-block;
		min-width: 6rem;
		font-weight: 600;
	}
	.time-cell {
		display: inline-block;
		min-width: 3.4rem;
	}
	.range-cell {
		display: inline-block;
		min-width: 6.5rem;
	}
	.score-cell {
		display: inline-block;
		min-width: 2.4rem;
		text-align: right;
	}
	.avg-cell {
		display: inline-block;
		min-width: 3.4rem;
	}
	.conditions {
		flex: 1 1 100%;
		font-size: 0.85em;
		min-width: 12rem;
	}
	@media (max-width: 720px) {
		.trip-finder select {
			padding: 0.35rem 0.45rem;
			margin-left: 0.25rem;
		}
		.window-row {
			gap: 0.4rem;
			padding: 0.35rem 0.5rem;
		}
		.day-label {
			min-width: 4.5rem;
			font-size: 0.92em;
		}
		.range-cell {
			min-width: 5.5rem;
			font-size: 0.9em;
		}
		.conditions {
			font-size: 0.78em;
			min-width: 100%;
			flex-basis: 100%;
			opacity: 0.85;
		}
		.legend {
			margin-left: 0;
		}
		.legend-bar {
			width: 50px;
		}
		.best-pick {
			padding: 0.5rem 0.6rem;
		}
	}
	@media (max-width: 420px) {
		.conditions {
			display: none;
		}
		.avg-cell {
			display: none;
		}
	}
	.override-badge {
		font-size: 0.75em;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: rgba(56, 189, 248, 0.15);
		color: var(--accent);
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
