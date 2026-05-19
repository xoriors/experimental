<script lang="ts">
	import type { FusedHour } from '$lib/types';
	import { aggregate3h } from '$lib/fusion';
	import ForecastRow from './ForecastRow.svelte';

	type Props = {
		hours: FusedHour[];
		expanded: Set<string>;
		onToggleSlot: (slot: string) => void;
		mode: 'sea' | 'land';
	};

	let { hours, expanded, onToggleSlot, mode }: Props = $props();

	const slots = $derived(aggregate3h(hours));
	const coastal = $derived(hours.some((h) => h.waveHsM != null));
</script>

{#if hours.length === 0}
	<p class="muted">No forecast data yet — pick a location to begin.</p>
{:else}
	<table class="forecast">
		<thead>
			<tr>
				<th>Time</th>
				<th></th>
				<th>Temp</th>
				<th>Wind / gust</th>
				<th>Rain / Pₚ</th>
				<th>Cloud</th>
				<th>Vis</th>
				<th>Wave</th>
			</tr>
		</thead>
		<tbody>
			{#each slots as slot}
				{@const key = slot.startHour.toString().padStart(2, '0')}
				<ForecastRow
					{slot}
					expanded={expanded.has(key)}
					onToggle={() => onToggleSlot(key)}
					{coastal}
					{mode}
				/>
			{/each}
		</tbody>
	</table>
{/if}
