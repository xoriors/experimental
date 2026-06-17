<script lang="ts">
	import type { DayOverride, DayKey, DaylightDay, FusedHour, TripMode } from '$lib/types';
	import { aggregate3h } from '$lib/fusion';
	import { filterHoursForDay } from '$lib/time';
	import { dayLookup } from '$lib/daylight';
	import { hourTripScore, windowScoreAt } from '$lib/trip-score';
	import { minToHHMM, hhmmToMin } from '$lib/url-state';
	import { t } from '$lib/i18n/index.svelte';
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
		daylight?: DaylightDay[];
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
		todayIso,
		daylight = []
	}: Props = $props();

	const daylightMap = $derived(dayLookup(daylight));
	const todayDaylight = $derived(() => {
		const [y, m, d] = todayIso.split('-').map(Number);
		const target = new Date(y, (m ?? 1) - 1, d ?? 1);
		const off = day === 'today' ? 0 : day === 'tomorrow' ? 1 : 2;
		target.setDate(target.getDate() + off);
		const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
		return daylightMap.get(iso);
	});

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

	const DURATIONS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 6, 8, 12];

	function formatDuration(d: number): string {
		if (d === 0) return t('trip.rightNow');
		if (d < 1) return t('trip.minutesSuffix', { n: Math.round(d * 60) });
		if (d === Math.floor(d)) return t('trip.hoursSuffix', { n: d });
		const h = Math.floor(d);
		const m = Math.round((d - h) * 60);
		return t('trip.hoursMinutesSuffix', { h, m });
	}

	const isRightNow = $derived(durationH === 0);
	const allDay = $derived(minMin === 0 && maxMin >= 1380);

	function onAllDayChange(e: Event) {
		const checked = (e.target as HTMLInputElement).checked;
		if (checked) {
			onChangeOverride({ min: topMinMin === 0 ? null : 0, max: topMaxMin >= 1380 ? null : 1380 });
		} else {
			onChangeOverride({ min: topMinMin === 9 * 60 ? null : 9 * 60, max: topMaxMin === 17 * 60 ? null : 17 * 60 });
		}
	}

	function snapHalfHour(min: number): number {
		return Math.max(0, Math.min(1410, Math.round(min / 30) * 30));
	}
	function parseTimeInput(value: string, fallback: number): number {
		const parsed = hhmmToMin(value);
		if (parsed !== null) return parsed;
		const m = /^(\d{1,2}):(\d{2})$/.exec(value);
		if (!m) return fallback;
		const h = Number(m[1]);
		const mm = Number(m[2]);
		if (!Number.isFinite(h) || !Number.isFinite(mm)) return fallback;
		return snapHalfHour(h * 60 + mm);
	}
	function onMinChange(e: Event) {
		const v = parseTimeInput((e.target as HTMLInputElement).value, minMin);
		onChangeOverride({ min: v === topMinMin ? null : v });
	}
	function onMaxChange(e: Event) {
		const v = parseTimeInput((e.target as HTMLInputElement).value, maxMin);
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

	type ColTip = { label: string; text: string };
	const colTips = $derived<Record<string, ColTip>>({
		time: { label: t('table.tipLabels.time'), text: t('table.tips.time') },
		temp: { label: t('table.tipLabels.temp'), text: t('table.tips.temp') },
		wind: { label: t('table.tipLabels.wind'), text: t('table.tips.wind') },
		rain: { label: t('table.tipLabels.rain'), text: t('table.tips.rain') },
		cloud: { label: t('table.tipLabels.cloud'), text: t('table.tips.cloud') },
		vis: { label: t('table.tipLabels.vis'), text: t('table.tips.vis') },
		wave: { label: t('table.tipLabels.wave'), text: t('table.tips.wave') }
	});
	let openTip: string | null = $state(null);
	function showTip(key: string) {
		openTip = key;
	}
	function closeTip() {
		openTip = null;
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') closeTip();
	}

	let scrollEl: HTMLDivElement | undefined = $state.raw();
	let mirrorEl: HTMLDivElement | undefined = $state.raw();
	let realTableEl: HTMLTableElement | undefined = $state.raw();
	let colWidths = $state<number[]>([]);

	$effect(() => {
		const src = scrollEl;
		const dst = mirrorEl;
		if (!src || !dst) return;
		dst.scrollLeft = src.scrollLeft;
		const onScroll = () => {
			dst.scrollLeft = src.scrollLeft;
		};
		src.addEventListener('scroll', onScroll, { passive: true });
		return () => src.removeEventListener('scroll', onScroll);
	});

	$effect(() => {
		const el = realTableEl;
		if (!el) return;
		const sync = () => {
			const ths = el.querySelectorAll<HTMLTableCellElement>('thead th');
			colWidths = Array.from(ths, (th) => th.getBoundingClientRect().width);
		};
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		el.querySelectorAll('thead th').forEach((th) => ro.observe(th));
		return () => ro.disconnect();
	});
</script>

<svelte:window onkeydown={onKey} />

{#if todayDaylight()}
	{@const dl = todayDaylight()}
	{#if dl}
		<div class="sun-times muted">
			<span>{t('forecast.sunrise')} <strong>{dl.sunrise.slice(11, 16)}</strong></span>
			<span>·</span>
			<span>{t('forecast.sunset')} <strong>{dl.sunset.slice(11, 16)}</strong></span>
		</div>
	{/if}
{/if}

<div class="interval-bar">
	<span class="muted" style="font-size: 0.85em; margin-right: 0.4rem;">{t('intervalBar.forThisDay')}</span>
	<label class="all-day-mini">
		<input type="checkbox" checked={allDay} onchange={onAllDayChange} disabled={isRightNow} />
		<span class="muted">{t('trip.allDay')}</span>
	</label>
	<label>
		<span class="muted">{t('intervalBar.earliest')}</span>
		<input
			type="time"
			step="1800"
			min="00:00"
			max="23:30"
			value={minToHHMM(minMin)}
			onchange={onMinChange}
			disabled={allDay || isRightNow}
		/>
	</label>
	<label>
		<span class="muted">{t('intervalBar.latest')}</span>
		<input
			type="time"
			step="1800"
			min="00:00"
			max="23:30"
			value={minToHHMM(maxMin)}
			onchange={onMaxChange}
			disabled={allDay || isRightNow}
		/>
	</label>
	<label>
		<span class="muted">{t('intervalBar.duration')}</span>
		<select value={durationH} onchange={onDurationChange}>
			{#each DURATIONS as d}
				<option value={d}>{formatDuration(d)}</option>
			{/each}
		</select>
	</label>
	<label>
		<span class="muted">{t('intervalBar.mode')}</span>
		<select value={override.mode ?? topMode} onchange={onModeChange}>
			<option value="sea">{t('trip.modeSea')}</option>
			<option value="land">{t('trip.modeLand')}</option>
		</select>
	</label>
	{#if overridden}
		<button type="button" class="btn-ghost" style="padding: 0.3rem 0.6rem;" onclick={onResetOverride} title={t('intervalBar.resetTitle')}>
			{t('intervalBar.reset')}
		</button>
		<span class="muted" style="font-size: 0.72em;">{t('intervalBar.customSuffix', { min: minToHHMM(topMinMin), max: minToHHMM(topMaxMin), dur: topDurationH, mode: topMode === 'sea' ? t('trip.modeSea') : t('trip.modeLand') })}</span>
	{:else}
		<span class="muted" style="font-size: 0.72em;">{t('intervalBar.inherits')}</span>
	{/if}
</div>

{#if dayHours.length === 0}
	<p class="muted">{t('forecast.noData')}</p>
{:else}
	<details class="ref-scale">
		<summary>{t('refScale.summary')}</summary>
		<div class="ref-grid">
			<div class="ref-row">
				<span class="ref-label">{t('refScale.wind')}</span>
				<span class="badge-good">{t('refScale.windGood')}</span>
				<span class="badge-ok">{t('refScale.windOk')}</span>
				<span class="badge-unsafe">{t('refScale.windUnsafe')}</span>
			</div>
			<div class="ref-row">
				<span class="ref-label">{t('refScale.gust')}</span>
				<span class="badge-good">{t('refScale.gustGood')}</span>
				<span class="badge-ok">{t('refScale.gustOk')}</span>
				<span class="badge-unsafe">{t('refScale.gustUnsafe')}</span>
			</div>
			<div class="ref-row">
				<span class="ref-label">{t('refScale.rain')}</span>
				<span class="badge-good">{t('refScale.rainGood')}</span>
				<span class="badge-ok">{t('refScale.rainOk')}</span>
				<span class="badge-poor">{t('refScale.rainPoor')}</span>
				<span class="badge-unsafe">{t('refScale.rainUnsafe')}</span>
			</div>
			{#if mode === 'sea'}
				<div class="ref-row">
					<span class="ref-label">{t('refScale.waveHs')}</span>
					<span class="badge-good">{t('refScale.waveGood')}</span>
					<span class="badge-ok">{t('refScale.waveOk')}</span>
					<span class="badge-poor">{t('refScale.wavePoor')}</span>
					<span class="badge-unsafe">{t('refScale.waveUnsafe')}</span>
				</div>
			{/if}
		</div>
	</details>
	{#snippet theadRow()}
		<tr>
			<th><button type="button" class="th-info" title={colTips.time.text} onclick={() => showTip('time')}>{t('table.time')}</button></th>
			<th><button type="button" class="th-info" title={colTips.temp.text} onclick={() => showTip('temp')}>{t('table.temp')}</button></th>
			<th><button type="button" class="th-info" title={colTips.wind.text} onclick={() => showTip('wind')}>{t('table.windGust')}</button></th>
			<th><button type="button" class="th-info" title={colTips.rain.text} onclick={() => showTip('rain')}>{t('table.rainPp')}</button></th>
			<th><button type="button" class="th-info" title={colTips.cloud.text} onclick={() => showTip('cloud')}>{t('table.cloud')}</button></th>
			<th><button type="button" class="th-info" title={colTips.vis.text} onclick={() => showTip('vis')}>{t('table.vis')}</button></th>
			{#if mode === 'sea'}
				<th><button type="button" class="th-info" title={colTips.wave.text} onclick={() => showTip('wave')}>{t('table.wave')}</button></th>
			{/if}
		</tr>
	{/snippet}
	<div class="thead-mirror" bind:this={mirrorEl} aria-hidden="true">
		<table class="forecast forecast-mirror-table">
			<colgroup>
				{#each colWidths as w}
					<col style="width: {w}px" />
				{/each}
			</colgroup>
			<thead>{@render theadRow()}</thead>
		</table>
	</div>
	<div class="forecast-scroll" bind:this={scrollEl}>
		<table class="forecast" bind:this={realTableEl}>
			<thead class="real-thead-hidden">{@render theadRow()}</thead>
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
						dayInfo={todayDaylight()}
					/>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if openTip}
	<div
		class="tip-backdrop"
		role="presentation"
		onclick={closeTip}
		onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') closeTip(); }}
	>
		<div
			class="tip-card"
			role="dialog"
			aria-modal="true"
			aria-labelledby="tip-title"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<h3 id="tip-title">{colTips[openTip].label}</h3>
			<p>{colTips[openTip].text}</p>
			<button type="button" class="btn-ghost" onclick={closeTip}>{t('table.close')}</button>
		</div>
	</div>
{/if}

<style>
	.sun-times {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.85em;
		padding: 0.35rem 0.1rem 0.45rem;
	}
	.sun-times strong {
		color: var(--fg);
		font-variant-numeric: tabular-nums;
	}
	.interval-bar {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
		padding: 0.5rem 0;
		margin-bottom: 0.5rem;
		border-bottom: 1px solid var(--border);
	}
	.all-day-mini {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-weight: 600;
		cursor: pointer;
	}
	.all-day-mini input[type='checkbox'] {
		width: 14px;
		height: 14px;
		accent-color: var(--good, #4ade80);
		cursor: pointer;
	}
	.interval-bar input:disabled,
	.interval-bar select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.interval-bar select,
	.interval-bar input[type='time'] {
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.3rem 0.5rem;
		margin-left: 0.3rem;
		font: inherit;
		font-variant-numeric: tabular-nums;
	}
	.interval-bar input[type='time']::-webkit-calendar-picker-indicator {
		filter: invert(0.7);
		cursor: pointer;
	}
	.th-info {
		all: unset;
		cursor: help;
		text-decoration: underline dotted currentColor;
		text-underline-offset: 3px;
		font: inherit;
		color: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		padding: 2px 0;
	}
	.th-info:focus-visible {
		outline: 2px solid var(--good);
		outline-offset: 2px;
		border-radius: 2px;
	}
	.th-info.icon-only {
		text-decoration: none;
		opacity: 0.6;
	}
	.tip-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 1000;
	}
	.tip-card {
		background: var(--bg-elev, var(--bg));
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1rem 1.1rem;
		max-width: 22rem;
		width: 100%;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
	}
	.tip-card h3 {
		margin: 0 0 0.4rem 0;
		font-size: 1rem;
	}
	.tip-card p {
		margin: 0 0 0.7rem 0;
		font-size: 0.92em;
		line-height: 1.4;
	}
	.tip-card .btn-ghost {
		padding: 0.35rem 0.7rem;
	}
	.ref-scale {
		font-size: 0.82em;
		margin-bottom: 0.6rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.35rem 0.6rem;
		background: var(--bg-elev, transparent);
	}
	.ref-scale > summary {
		cursor: pointer;
		color: var(--fg-dim);
		font-weight: 500;
		list-style: none;
	}
	.ref-scale > summary::-webkit-details-marker {
		display: none;
	}
	.ref-scale > summary::before {
		content: '▸ ';
		font-size: 0.85em;
	}
	.ref-scale[open] > summary::before {
		content: '▾ ';
	}
	.ref-grid {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-top: 0.4rem;
	}
	.ref-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
	}
	.ref-label {
		min-width: 4.2rem;
		color: var(--fg-dim);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.ref-row :global(.badge-good),
	.ref-row :global(.badge-ok),
	.ref-row :global(.badge-poor),
	.ref-row :global(.badge-unsafe) {
		padding: 0.05rem 0.4rem;
		border-radius: 4px;
		font-size: 0.92em;
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 720px) {
		.interval-bar {
			gap: 0.4rem;
			font-size: 0.88em;
		}
		.interval-bar select,
		.interval-bar input[type='time'] {
			padding: 0.25rem 0.4rem;
			margin-left: 0.2rem;
		}
		.ref-scale {
			font-size: 0.78em;
		}
		.ref-label {
			min-width: 3.4rem;
		}
	}
</style>
