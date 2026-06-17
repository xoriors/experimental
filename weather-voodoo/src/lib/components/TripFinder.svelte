<script lang="ts">
	import { tick } from 'svelte';
	import { view, effectiveConfig } from '$lib/state.svelte';
	import {
		findBestWindows,
		pickTopNonOverlapping,
		scoreToCss,
		type TripWindow
	} from '$lib/trip-score';
	import { filterHoursForDay, localIsoDate, localNowIso } from '$lib/time';
	import { minToHHMM, hhmmToMin } from '$lib/url-state';
	import { round1 } from '$lib/units';
	import { t } from '$lib/i18n/index.svelte';
	import type { DayKey, FusedHour } from '$lib/types';

	type Props = {
		hours: FusedHour[];
		timezone: string;
	};

	let { hours, timezone }: Props = $props();

	function toHourBounds(minMin: number, maxMin: number): [number, number] {
		return [Math.ceil(minMin / 60), Math.floor(maxMin / 60)];
	}

	const activeMode = $derived(view.tripMode);
	const topBounds = $derived(toHourBounds(view.tripMinMin, view.tripMaxMin));
	const nowIso = $derived(localNowIso());
	const allWindows = $derived(
		findBestWindows(hours, view.tripDurationH, activeMode, topBounds[0], topBounds[1], nowIso)
	);
	const topOverall = $derived(pickTopNonOverlapping(allWindows, 2));
	const bestOverall = $derived<TripWindow | undefined>(topOverall[0]);
	const secondOverall = $derived<TripWindow | undefined>(topOverall[1]);

	const todayIso = $derived(localIsoDate());

	type DayLabel = { key: DayKey; label: string };
	const DAYS = $derived<DayLabel[]>([
		{ key: 'today', label: t('days.today') },
		{ key: 'tomorrow', label: t('days.tomorrow') },
		{ key: 'd2', label: t('days.d2') }
	]);

	const bestPerDay = $derived(
		DAYS.map(({ key, label }) => {
			const dayHours = filterHoursForDay(hours, key, todayIso);
			const eff = effectiveConfig(key);
			const mode = eff.mode;
			const [minHr, maxHr] = toHourBounds(eff.min, eff.max);
			const wins = findBestWindows(dayHours, eff.durationH, mode, minHr, maxHr, nowIso);
			const top = pickTopNonOverlapping(wins, 2);
			return { key, label, windows: top, eff, mode };
		})
	);

	// Fractional hours for sub-hour trips (30-min granularity up to 4h,
	// then whole hours). findBestWindows / windowScoreAt use Math.ceil to
	// pick the matching number of hourly forecast samples.
	const DURATIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 6, 8, 12];

	function formatDuration(d: number): string {
		if (d < 1) return t('trip.minutesSuffix', { n: Math.round(d * 60) });
		if (d === Math.floor(d)) return t('trip.hoursSuffix', { n: d });
		const h = Math.floor(d);
		const m = Math.round((d - h) * 60);
		return t('trip.hoursMinutesSuffix', { h, m });
	}

	function onDurationChange(e: Event) {
		view.tripDurationH = Number((e.target as HTMLSelectElement).value);
	}

	// "All day" = the full 24h is allowed as a start window. Default range
	// is 00:00–23:00 which already covers all 24 start hours; we treat any
	// range that spans the full 0–1380 as "all day" for the toggle.
	const allDay = $derived(view.tripMinMin === 0 && view.tripMaxMin >= 1380);

	function onAllDayChange(e: Event) {
		const checked = (e.target as HTMLInputElement).checked;
		if (checked) {
			view.tripMinMin = 0;
			view.tripMaxMin = 1380;
		} else {
			// Sensible daylight defaults when leaving "all day".
			view.tripMinMin = 9 * 60;
			view.tripMaxMin = 17 * 60;
		}
	}
	function parseTimeInput(value: string, fallback: number): number {
		const parsed = hhmmToMin(value);
		if (parsed !== null) return parsed;
		const m = /^(\d{1,2}):(\d{2})$/.exec(value);
		if (!m) return fallback;
		const h = Number(m[1]);
		const mm = Number(m[2]);
		if (!Number.isFinite(h) || !Number.isFinite(mm)) return fallback;
		return nearestHalfHour(h * 60 + mm);
	}
	function onMinChange(e: Event) {
		view.tripMinMin = parseTimeInput((e.target as HTMLInputElement).value, view.tripMinMin);
	}
	function onMaxChange(e: Event) {
		view.tripMaxMin = parseTimeInput((e.target as HTMLInputElement).value, view.tripMaxMin);
	}

	function nowMinutesLocal(): number {
		const d = new Date();
		return d.getHours() * 60 + d.getMinutes();
	}

	function nearestHalfHour(min: number): number {
		return Math.max(0, Math.min(1410, Math.round(min / 30) * 30));
	}

	function setMinNow() {
		view.tripMinMin = nearestHalfHour(nowMinutesLocal());
	}
	function setMaxNow() {
		view.tripMaxMin = nearestHalfHour(nowMinutesLocal());
	}

	function pad2(n: number): string {
		return n.toString().padStart(2, '0');
	}

	async function selectWindow(w: TripWindow, dur: number) {
		const date = w.startTime.slice(0, 10);
		const todayDate = todayIso;
		const tomorrowDate = localIsoDate(new Date(Date.now() + 86400_000));
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
		if (date === today) return t('days.today');
		if (date === tomorrow) return t('days.tomorrow');
		if (date === d2) return t('days.d2');
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
		parts.push(t('trip.cond.wind', { x: round1(maxWind), y: round1(maxGust) }));
		if (maxWave != null) parts.push(t('trip.cond.waves', { x: round1(maxWave) }));
		parts.push(t('trip.cond.rain', { x: round1(maxRain) }));
		parts.push(t('trip.cond.vis', { x: round1(minVis) }));
		return parts.join(t('trip.separator'));
	}

	const bestCss = $derived(bestOverall ? scoreToCss(bestOverall.score) : { bg: '', border: 'transparent' });
</script>

<div class="card trip-finder">
	<div class="row" style="gap: 1rem; align-items: center;">
		<label class="all-day">
			<input type="checkbox" checked={allDay} onchange={onAllDayChange} />
			<span>{t('trip.allDay')}</span>
		</label>
		<label>
			<span class="muted">{t('trip.earliestStart')}</span>
			<input
				type="time"
				step="1800"
				min="00:00"
				max="23:30"
				value={minToHHMM(view.tripMinMin)}
				onchange={onMinChange}
				disabled={allDay}
			/>
			<button type="button" class="now-btn" onclick={setMinNow} title={t('trip.nowTitle')} disabled={allDay}>{t('trip.now')}</button>
		</label>
		<label>
			<span class="muted">{t('trip.latestStart')}</span>
			<input
				type="time"
				step="1800"
				min="00:00"
				max="23:30"
				value={minToHHMM(view.tripMaxMin)}
				onchange={onMaxChange}
				disabled={allDay}
			/>
			<button type="button" class="now-btn" onclick={setMaxNow} title={t('trip.nowTitle')} disabled={allDay}>{t('trip.now')}</button>
		</label>
		<label>
			<span class="muted">{t('trip.duration')}</span>
			<select onchange={onDurationChange} value={view.tripDurationH}>
				{#each DURATIONS as d}
					<option value={d}>{formatDuration(d)}</option>
				{/each}
			</select>
		</label>
		<div class="legend" title={t('trip.legendTitle')}>
			<span class="legend-bar"></span>
			<span class="muted" style="font-size: 0.75em;">{t('trip.legendRange')}</span>
		</div>
	</div>

	{#if bestOverall}
		<button
			type="button"
			class="best-pick"
			style="border-left: 4px solid {bestCss.border}; background: {bestCss.bg};"
			onclick={() => selectWindow(bestOverall, view.tripDurationH)}
			title={t('trip.clickToHighlight')}
		>
			<div style="font-size: 1.1em;">
				<strong>{t('trip.bestAcross3Days')}</strong> {formatDay(bestOverall.startTime)} {bestOverall.startTime.slice(11, 16)} —
				<strong>{bestOverall.score}/100</strong>
				<span class="muted">{t('trip.avgInline', { n: bestOverall.avgScore })}</span>
			</div>
			<div class="muted" style="margin-top: 0.25rem;">
				{t('trip.windowSuffix', { n: view.tripDurationH })} {formatRange(bestOverall)}{t('trip.separator')}{summariseConditions(bestOverall.hours)}
			</div>
		</button>

		{#if secondOverall}
			{@const secondCss = scoreToCss(secondOverall.score)}
			<button
				type="button"
				class="best-pick best-pick--alt"
				style="border-left: 4px solid {secondCss.border}; background: {secondCss.bg};"
				onclick={() => selectWindow(secondOverall, view.tripDurationH)}
				title={t('trip.clickToHighlight')}
			>
				<div>
					<strong>{t('trip.secondBest')}</strong> {formatDay(secondOverall.startTime)} {secondOverall.startTime.slice(11, 16)} —
					<strong>{secondOverall.score}/100</strong>
					<span class="muted">{t('trip.avgInline', { n: secondOverall.avgScore })}</span>
				</div>
				<div class="muted" style="margin-top: 0.2rem;">
					{t('trip.windowSuffix', { n: view.tripDurationH })} {formatRange(secondOverall)}{t('trip.separator')}{summariseConditions(secondOverall.hours)}
				</div>
			</button>
		{/if}

		<div style="margin-top: 0.6rem;">
			<div class="muted" style="font-size: 0.85em; margin-bottom: 0.3rem;">{t('trip.bestPerDay')}</div>
			<ul class="window-list">
				{#each bestPerDay as entry}
					<li>
						{#if entry.windows.length === 0}
							<div class="window-row" style="opacity: 0.6;">
								<span class="day-label">{entry.label}</span>
								<span class="muted">{t('trip.noWindow')}</span>
							</div>
						{:else}
							{#each entry.windows as w, idx}
								{@const css = scoreToCss(w.score)}
								<button
									type="button"
									class="window-row"
									class:window-row--alt={idx > 0}
									style="border-left: 3px solid {css.border}; background: {css.bg};"
									onclick={() => selectWindow(w, entry.eff.durationH)}
									title={t('trip.clickToHighlight')}
								>
									<span class="day-label">{idx === 0 ? entry.label : ''}</span>
									{#if idx > 0}<span class="muted alt-prefix">{t('trip.secondPrefix')}</span>{/if}
									<span class="time-cell">{w.startTime.slice(11, 16)}</span>
									<span class="range-cell">{formatRange(w)}</span>
									<strong class="score-cell">{w.score}</strong>
									<span class="muted avg-cell">{t('trip.avg', { n: w.avgScore })}</span>
									<span class="muted conditions">{summariseConditions(w.hours)}</span>
									{#if idx === 0 && (entry.eff.durationH !== view.tripDurationH || entry.eff.mode !== view.tripMode)}
										<span class="muted override-badge">{t('trip.overrideBadge', { n: entry.eff.durationH, mode: entry.mode === 'sea' ? t('trip.modeSea') : t('trip.modeLand') })}</span>
									{/if}
								</button>
							{/each}
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<p class="muted">{t('trip.notEnoughData')}</p>
	{/if}

	<p class="muted" style="font-size: 0.75em; margin-top: 0.5rem;">
		{activeMode === 'sea' ? t('trip.scoreCombinesSea', { timezone }) : t('trip.scoreCombinesLand', { timezone })}
	</p>
</div>

<style>
	.trip-finder select,
	.trip-finder input[type='time'] {
		background: var(--bg-elev, rgba(255, 255, 255, 0.05));
		color: var(--fg);
		border: 1px solid var(--accent, #38bdf8);
		border-radius: 6px;
		padding: 0.45rem 0.6rem;
		margin-left: 0.4rem;
		font: inherit;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.15) inset;
	}
	.trip-finder select:focus,
	.trip-finder input[type='time']:focus {
		outline: 2px solid var(--accent, #38bdf8);
		outline-offset: 1px;
	}
	.trip-finder input[type='time']::-webkit-calendar-picker-indicator {
		filter: invert(0.8);
		cursor: pointer;
		opacity: 0.85;
	}
	.now-btn {
		background: var(--bg-elev, rgba(255, 255, 255, 0.05));
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.4rem 0.65rem;
		margin-left: 0.3rem;
		font: inherit;
		font-size: 0.85em;
		font-weight: 600;
		cursor: pointer;
	}
	.now-btn:disabled,
	.trip-finder input:disabled,
	.trip-finder select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.all-day {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 600;
		cursor: pointer;
	}
	.all-day input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: var(--good, #4ade80);
		cursor: pointer;
	}
	.now-btn:hover {
		background: rgba(56, 189, 248, 0.12);
		border-color: var(--accent, #38bdf8);
		color: var(--accent, #38bdf8);
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
	.best-pick--alt {
		margin-top: 0.4rem;
		padding: 0.45rem 0.75rem;
		font-size: 0.92em;
		opacity: 0.92;
	}
	.window-row--alt {
		margin-top: -0.1rem;
		opacity: 0.92;
	}
	.alt-prefix {
		font-size: 0.78em;
		margin-right: 0.25rem;
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
		.trip-finder select,
		.trip-finder input[type='time'] {
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
