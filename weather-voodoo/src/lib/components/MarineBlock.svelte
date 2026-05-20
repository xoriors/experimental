<script lang="ts">
	import type { FusedHour } from '$lib/types';
	import { round1, seaStateFromHs } from '$lib/units';

	let { hour }: { hour: FusedHour } = $props();
</script>

{#if hour.waveHsM != null}
	<div class="muted">
		Sea: {seaStateFromHs(hour.waveHsM)} (H_s {round1(hour.waveHsM)} m{#if hour.wavePeriodS}, period {round1(hour.wavePeriodS)} s{/if}{#if hour.swellHsM != null}, swell {round1(hour.swellHsM)} m{/if})
	</div>
{/if}
