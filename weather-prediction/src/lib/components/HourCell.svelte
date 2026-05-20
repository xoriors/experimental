<script lang="ts">
	import type { FusedHour } from '$lib/types';
	import { degToCompass, round1 } from '$lib/units';
	import { scoreToCss } from '$lib/trip-score';
	import WxIcon from './icons/WxIcon.svelte';

	type Props = {
		hour: FusedHour;
		score: number | null;
		outside?: boolean;
		coveredOnly?: boolean;
		highlighted?: boolean;
	};

	let {
		hour,
		score,
		outside = false,
		coveredOnly = false,
		highlighted = false
	}: Props = $props();
	const timeLabel = $derived(hour.time.slice(11, 16));
	const css = $derived(
		score == null || outside
			? { bg: 'transparent', border: 'transparent' }
			: scoreToCss(score)
	);
	const chipTitle = $derived(
		outside
			? `${score ?? '-'} — outside your trip window; adjust Earliest/Latest to include this hour`
			: coveredOnly
				? `${score ?? '-'} — during your trip but not a valid start time (score is for this hour's conditions)`
				: 'Score 0–100 for a trip starting at this hour'
	);
</script>

<tr
	class="detail hour"
	class:highlight={highlighted}
	class:outside
	data-hour-time={hour.time}
	style="--row-bg: {css.bg}; --row-border: {css.border};"
>
	<td>
		{timeLabel}
		<span class="hour-score" class:outside-chip={outside} title={chipTitle}>
			{score == null ? '—' : score}
		</span>
	</td>
	<td><WxIcon code={hour.weatherCode} /></td>
	<td>{round1(hour.tempC)}°</td>
	<td>{round1(hour.windKn)} / {round1(hour.gustKn)} kn {degToCompass(hour.windDirDeg)}</td>
	<td>{round1(hour.precipMmH)} mm <span class="muted">({hour.pop}%)</span></td>
	<td>{round1(hour.cloudPct)}%</td>
	<td>{round1(hour.visKm)} km</td>
	<td>
		{#if hour.waveHsM != null}{round1(hour.waveHsM)} m{:else}—{/if}
	</td>
</tr>

<style>
	tr.hour {
		background: var(--row-bg, transparent);
		scroll-margin-top: 1rem;
	}
	tr.hour > td:first-child {
		border-left: 4px solid var(--row-border, transparent);
	}
	tr.hour.outside {
		opacity: 0.5;
	}
	.hour-score {
		display: inline-block;
		min-width: 2rem;
		margin-left: 0.4rem;
		padding: 0.05rem 0.4rem;
		font-size: 0.75em;
		font-weight: 600;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.1);
		color: var(--fg);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	.hour-score.outside-chip {
		background: rgba(255, 255, 255, 0.04);
		color: var(--fg-dim);
		font-weight: 500;
	}
	tr.hour.highlight {
		outline: 2px solid #38bdf8;
		outline-offset: -2px;
	}
</style>
