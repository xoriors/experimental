<script lang="ts">
	import type { FusedHour } from '$lib/types';
	import { degToCompass, round1 } from '$lib/units';
	import WxIcon from './icons/WxIcon.svelte';

	let { hour }: { hour: FusedHour } = $props();
	const timeLabel = $derived(hour.time.slice(11, 16));
</script>

<tr class="detail">
	<td>{timeLabel}</td>
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
