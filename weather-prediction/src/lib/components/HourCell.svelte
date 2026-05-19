<script lang="ts">
	import type { FusedHour } from '$lib/types';
	import { degToCompass, round1 } from '$lib/units';
	import { hourTripScore, scoreToCss } from '$lib/trip-score';
	import WxIcon from './icons/WxIcon.svelte';

	type Props = {
		hour: FusedHour;
		mode: 'sea' | 'land';
		highlighted?: boolean;
	};

	let { hour, mode, highlighted = false }: Props = $props();
	const timeLabel = $derived(hour.time.slice(11, 16));
	const hScore = $derived(hourTripScore(hour, mode));
	const css = $derived(scoreToCss(hScore));
</script>

<tr
	class="detail hour"
	class:highlight={highlighted}
	style="--row-bg: {css.bg}; --row-border: {css.border};"
>
	<td>
		{timeLabel}
		<span class="hour-score" title="Trip score 0–100 for this hour">{hScore}</span>
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
	}
	tr.hour > td:first-child {
		border-left: 4px solid var(--row-border, transparent);
	}
	.hour-score {
		display: inline-block;
		min-width: 2rem;
		margin-left: 0.4rem;
		padding: 0.05rem 0.4rem;
		font-size: 0.72em;
		font-weight: 600;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		color: var(--fg);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	tr.hour.highlight {
		outline: 2px solid #38bdf8;
		outline-offset: -2px;
	}
</style>
