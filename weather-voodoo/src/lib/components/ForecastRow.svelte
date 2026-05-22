<script lang="ts">
	import type { ThreeHourAggregate } from '$lib/fusion';
	import { degToCompass, round1 } from '$lib/units';
	import { summariseHour } from '$lib/activities';
	import { scoreToCss } from '$lib/trip-score';
	import { view } from '$lib/state.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import WxIcon from './icons/WxIcon.svelte';
	import HourCell from './HourCell.svelte';
	import MarineBlock from './MarineBlock.svelte';
	import type { DaylightDay, FusedHour } from '$lib/types';
	import { isDaylight, sunPhase } from '$lib/daylight';

	type Props = {
		slot: ThreeHourAggregate;
		expanded: boolean;
		onToggle: () => void;
		coastal: boolean;
		mode: 'sea' | 'land';
		hourScores: Map<string, number | null>;
		outsideInterval: Set<string>;
		outsideStartRange: Set<string>;
		dayInfo?: DaylightDay;
	};

	let {
		slot,
		expanded,
		onToggle,
		coastal,
		mode,
		hourScores,
		outsideInterval,
		outsideStartRange,
		dayInfo
	}: Props = $props();

	const slotNight = $derived(
		slot.hours.length > 0 && slot.hours.every((h) => !isDaylight(h.time, dayInfo))
	);
	const slotMixed = $derived(
		!slotNight && slot.hours.some((h) => !isDaylight(h.time, dayInfo))
	);
	const slotPhases = $derived(slot.hours.map((h) => sunPhase(h.time, dayInfo)));
	const slotHasSunrise = $derived(slotPhases.some((p) => p === 'sunrise-hour'));
	const slotHasSunset = $derived(slotPhases.some((p) => p === 'sunset-hour'));

	const highlightStartMs = $derived(view.highlight ? Date.parse(view.highlight + ':00Z') : null);
	const highlightEndMs = $derived(
		highlightStartMs != null ? highlightStartMs + view.tripDurationH * 3600_000 : null
	);

	function isHourHighlighted(time: string): boolean {
		if (highlightStartMs == null || highlightEndMs == null) return false;
		const t = Date.parse(time + ':00Z');
		return t >= highlightStartMs && t < highlightEndMs;
	}

	const slotHighlighted = $derived(slot.hours.some((h) => isHourHighlighted(h.time)));

	const start = $derived(slot.startHour.toString().padStart(2, '0'));
	const end = $derived(((slot.startHour + 3) % 24).toString().padStart(2, '0'));

	const summary: FusedHour = $derived({
		time: slot.hours[0]?.time ?? '',
		tempC: slot.agg.tempC,
		apparentC: slot.agg.tempC,
		precipMmH: slot.agg.precipMmH,
		rainMmH: slot.agg.precipMmH,
		showersMmH: 0,
		pop: slot.agg.pop,
		weatherCode: slot.agg.weatherCode,
		cloudPct: slot.agg.cloudPct,
		visKm: slot.agg.visKm,
		windKn: slot.agg.windKn,
		gustKn: slot.agg.gustKn,
		windDirDeg: slot.hours[0]?.windDirDeg ?? 0,
		humidityPct: slot.hours[0]?.humidityPct ?? 0,
		pressureHpa: slot.hours[0]?.pressureHpa ?? 0,
		uv: slot.agg.uv,
		waveHsM: slot.agg.waveHsM,
		wavePeriodS: slot.hours[0]?.wavePeriodS ?? null,
		swellHsM: slot.hours[0]?.swellHsM ?? null
	});

	const activitySummary = $derived(summariseHour(summary, mode));
	const summaryText = $derived.by(() => {
		const parts: string[] = [];
		if (activitySummary.good.length) {
			const items = activitySummary.good.map((a) => t(`activities.${a}`)).join(', ');
			parts.push(t('summary.goodFor', { items }));
		}
		if (activitySummary.avoid.length) {
			const items = activitySummary.avoid.map((a) => t(`activities.${a}`)).join(', ');
			parts.push(t('summary.avoid', { items }));
		}
		if (!parts.length) parts.push(t('summary.mixed'));
		return parts.join(' ');
	});

	const slotScore = $derived.by(() => {
		const valid: number[] = [];
		for (const h of slot.hours) {
			if (outsideStartRange.has(h.time)) continue;
			const s = hourScores.get(h.time);
			if (s != null) valid.push(s);
		}
		return valid.length ? Math.max(...valid) : null;
	});

	const slotCovered = $derived(slot.hours.some((h) => !outsideInterval.has(h.time)));

	const rowCss = $derived(
		slotScore == null ? { bg: 'transparent', border: 'transparent' } : scoreToCss(slotScore)
	);
</script>

<tr
	class="slot"
	class:highlight={slotHighlighted}
	class:disabled={!slotCovered}
	class:night={slotNight}
	class:dim={slotMixed}
	data-slot-start={start}
	style="--row-bg: {rowCss.bg}; --row-border: {rowCss.border};"
	onclick={onToggle}
>
	<td>
		<span class="expand-caret" class:open={expanded}>▶</span>
		{start}–{end}
		{#if slotHasSunrise}<span class="sun-marker" title={t('forecast.sunriseInBlock')}>🌅</span>{:else if slotHasSunset}<span class="sun-marker" title={t('forecast.sunsetInBlock')}>🌇</span>{:else if slotNight}<span class="sun-marker" title={t('forecast.night')}>🌙</span>{/if}
		<span class="row-score" title={t('table.rowScoreTitle')}>
			{slotScore == null ? '—' : slotScore}
		</span>
	</td>
	<td class="cond-temp">
		<WxIcon code={slot.agg.weatherCode} />
		<span>{round1(slot.agg.tempC)}°</span>
	</td>
	<td>{round1(slot.agg.windKn)} / {round1(slot.agg.gustKn)} kn {degToCompass(slot.hours[0]?.windDirDeg ?? 0)}</td>
	<td>{round1(slot.agg.precipMmH)} mm <span class="muted">({slot.agg.pop}%)</span></td>
	<td>{round1(slot.agg.cloudPct)}%</td>
	<td>{round1(slot.agg.visKm)} km</td>
	{#if mode === 'sea'}
		<td>
			{#if coastal && slot.agg.waveHsM != null}{round1(slot.agg.waveHsM)} m{:else}—{/if}
		</td>
	{/if}
</tr>
<tr class="detail">
	<td colspan={mode === 'sea' ? 7 : 6}>
		<div class="activity-line">{summaryText}</div>
		{#if coastal}
			<MarineBlock hour={summary} />
		{/if}
	</td>
</tr>
{#if expanded}
	{#each slot.hours as h}
		<HourCell
			hour={h}
			score={hourScores.get(h.time) ?? null}
			outside={outsideInterval.has(h.time)}
			coveredOnly={!outsideInterval.has(h.time) && outsideStartRange.has(h.time)}
			highlighted={isHourHighlighted(h.time)}
			{dayInfo}
			{mode}
		/>
	{/each}
{/if}

<style>
	tr.slot {
		scroll-margin-top: 1rem;
	}
	tr.slot.highlight {
		outline: 2px solid #38bdf8;
		outline-offset: -2px;
	}
	tr.slot.disabled {
		opacity: 0.55;
	}
	tr.slot.night :global(td) {
		background-image: linear-gradient(rgba(15, 23, 42, 0.4), rgba(15, 23, 42, 0.4));
	}
	tr.slot.dim :global(td) {
		background-image: linear-gradient(rgba(15, 23, 42, 0.18), rgba(15, 23, 42, 0.18));
	}
	.sun-marker {
		margin-left: 0.3rem;
		font-size: 0.92em;
		vertical-align: -1px;
	}
	.row-score {
		display: inline-block;
		min-width: 1.5rem;
		margin-left: 0.25rem;
		padding: 0.05rem 0.3rem;
		font-size: 0.78em;
		font-weight: 600;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		color: var(--fg);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
</style>
