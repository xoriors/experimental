<script lang="ts">
	import type { DaylightDay, FusedHour } from '$lib/types';
	import { degToCompass, round1 } from '$lib/units';
	import { scoreToCss } from '$lib/trip-score';
	import { isDaylight, sunPhase } from '$lib/daylight';
	import WxIcon from './icons/WxIcon.svelte';

	type Props = {
		hour: FusedHour;
		score: number | null;
		outside?: boolean;
		coveredOnly?: boolean;
		highlighted?: boolean;
		dayInfo?: DaylightDay;
		mode?: 'sea' | 'land';
	};

	let {
		hour,
		score,
		outside = false,
		coveredOnly = false,
		highlighted = false,
		dayInfo,
		mode = 'sea'
	}: Props = $props();
	const timeLabel = $derived(hour.time.slice(11, 16));
	const phase = $derived(sunPhase(hour.time, dayInfo));
	const isNight = $derived(!isDaylight(hour.time, dayInfo));
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
	class:night={isNight}
	data-hour-time={hour.time}
	style="--row-bg: {css.bg}; --row-border: {css.border};"
>
	<td>
		{timeLabel}
		{#if phase === 'sunrise-hour'}<span class="sun-marker" title="Sunrise">🌅</span>{:else if phase === 'sunset-hour'}<span class="sun-marker" title="Sunset">🌇</span>{:else if isNight}<span class="sun-marker" title="Night">🌙</span>{/if}
		<span class="hour-score" class:outside-chip={outside} title={chipTitle}>
			{score == null ? '—' : score}
		</span>
	</td>
	<td class="cond-temp">
		<WxIcon code={hour.weatherCode} />
		<span>{round1(hour.tempC)}°</span>
	</td>
	<td>{round1(hour.windKn)} / {round1(hour.gustKn)} kn {degToCompass(hour.windDirDeg)}</td>
	<td>{round1(hour.precipMmH)} mm <span class="muted">({hour.pop}%)</span></td>
	<td>{round1(hour.cloudPct)}%</td>
	<td>{round1(hour.visKm)} km</td>
	{#if mode === 'sea'}
		<td>
			{#if hour.waveHsM != null}{round1(hour.waveHsM)} m{:else}—{/if}
		</td>
	{/if}
</tr>

<style>
	tr.hour {
		background: var(--row-bg, transparent);
		scroll-margin-top: 1rem;
	}
	tr.hour.night :global(td) {
		background-image: linear-gradient(rgba(15, 23, 42, 0.4), rgba(15, 23, 42, 0.4));
	}
	.sun-marker {
		margin-left: 0.25rem;
		margin-right: 0.05rem;
		font-size: 0.92em;
		vertical-align: -1px;
	}
	tr.hour > td:first-child {
		border-left: 4px solid var(--row-border, transparent);
	}
	tr.hour.outside {
		opacity: 0.5;
	}
	.hour-score {
		display: inline-block;
		min-width: 1.4rem;
		margin-left: 0.25rem;
		padding: 0.05rem 0.3rem;
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
