<script lang="ts">
	import type { DayOverride, DayKey, FusedHour, TripMode } from '$lib/types';
	import { aggregate3h } from '$lib/fusion';
	import { filterHoursForDay } from '$lib/time';
	import { hourTripScore, windowScoreAt } from '$lib/trip-score';
	import { minToHHMM, hhmmToMin } from '$lib/url-state';
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

	const DURATIONS = [1, 2, 3, 4, 6, 8, 12];

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
	const colTips: Record<string, ColTip> = {
		time: {
			label: 'Time',
			text: "Hour (HH:00) or aggregated range (HH–HH) in the destination's local timezone. Click a single-hour row to expand 3-hour summaries."
		},
		icon: {
			label: 'Conditions',
			text: 'Weather conditions icon: ☀ clear, 🌤 partly cloudy, ☁ overcast, 🌦 light rain, 🌧 rain, ⛈ thunderstorm.'
		},
		temp: { label: 'Temp', text: 'Air temperature at 2 m height, in degrees Celsius.' },
		wind: {
			label: 'Wind / gust',
			text: 'Sustained wind speed / peak gust, in knots (kn), followed by the cardinal direction the wind is coming FROM (e.g. W = westerly). Good < 12 kn, breezy 12–22, small-craft warning > 22.'
		},
		rain: {
			label: 'Rain / Pₚ',
			text: 'Total precipitation in millimetres per hour. Pₚ = probability of precipitation (0–100%). Dry < 0.5 mm/h, light 0.5–2, moderate 2–5, heavy > 5.'
		},
		cloud: { label: 'Cloud', text: 'Cloud cover, 0% = clear sky, 100% = fully overcast.' },
		vis: {
			label: 'Visibility',
			text: 'Horizontal visibility, in kilometres. Lower values (< 2 km) indicate fog, haze, or heavy rain.'
		},
		wave: {
			label: 'Wave Hₛ',
			text: 'Significant wave height (Hₛ) in metres — the average of the highest one-third of waves. Calm < 0.5 m, slight 0.5–1, moderate 1–2, rough > 2. Marine forecast only; missing for inland points.'
		}
	};
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

<div class="interval-bar">
	<span class="muted" style="font-size: 0.85em; margin-right: 0.4rem;">For this day:</span>
	<label>
		<span class="muted">earliest</span>
		<input
			type="time"
			step="1800"
			min="00:00"
			max="23:30"
			value={minToHHMM(minMin)}
			onchange={onMinChange}
		/>
	</label>
	<label>
		<span class="muted">latest</span>
		<input
			type="time"
			step="1800"
			min="00:00"
			max="23:30"
			value={minToHHMM(maxMin)}
			onchange={onMaxChange}
		/>
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
	<details class="ref-scale">
		<summary>Reference scale — what counts as good vs bad</summary>
		<div class="ref-grid">
			<div class="ref-row">
				<span class="ref-label">Wind</span>
				<span class="badge-good">&lt; 12 kn calm/light</span>
				<span class="badge-ok">12–22 kn breezy</span>
				<span class="badge-unsafe">&gt; 22 kn small-craft</span>
			</div>
			<div class="ref-row">
				<span class="ref-label">Gust</span>
				<span class="badge-good">&lt; 18 kn</span>
				<span class="badge-ok">18–28 kn</span>
				<span class="badge-unsafe">&gt; 28 kn unsafe boats</span>
			</div>
			<div class="ref-row">
				<span class="ref-label">Rain</span>
				<span class="badge-good">&lt; 0.5 mm/h dry</span>
				<span class="badge-ok">0.5–2 light</span>
				<span class="badge-poor">2–5 moderate</span>
				<span class="badge-unsafe">&gt; 5 heavy</span>
			</div>
			<div class="ref-row">
				<span class="ref-label">Wave Hₛ</span>
				<span class="badge-good">&lt; 0.5 m calm</span>
				<span class="badge-ok">0.5–1 slight</span>
				<span class="badge-poor">1–2 moderate</span>
				<span class="badge-unsafe">&gt; 2 rough</span>
			</div>
		</div>
	</details>
	{#snippet theadRow()}
		<tr>
			<th><button type="button" class="th-info" title={colTips.time.text} onclick={() => showTip('time')}>Time</button></th>
			<th><button type="button" class="th-info icon-only" title={colTips.icon.text} aria-label="Conditions icon legend" onclick={() => showTip('icon')}><span aria-hidden="true">ⓘ</span></button></th>
			<th><button type="button" class="th-info" title={colTips.temp.text} onclick={() => showTip('temp')}>Temp</button></th>
			<th><button type="button" class="th-info" title={colTips.wind.text} onclick={() => showTip('wind')}>Wind / gust</button></th>
			<th><button type="button" class="th-info" title={colTips.rain.text} onclick={() => showTip('rain')}>Rain / Pₚ</button></th>
			<th><button type="button" class="th-info" title={colTips.cloud.text} onclick={() => showTip('cloud')}>Cloud</button></th>
			<th><button type="button" class="th-info" title={colTips.vis.text} onclick={() => showTip('vis')}>Vis</button></th>
			<th><button type="button" class="th-info" title={colTips.wave.text} onclick={() => showTip('wave')}>Wave</button></th>
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
			<button type="button" class="btn-ghost" onclick={closeTip}>Close</button>
		</div>
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
