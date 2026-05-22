<script lang="ts">
	import type { FusedHour } from '$lib/types';
	import { round1, seaStateKey } from '$lib/units';
	import { t } from '$lib/i18n/index.svelte';

	let { hour }: { hour: FusedHour } = $props();
</script>

{#if hour.waveHsM != null}
	<div class="muted">
		{t('marine.seaLabel')}: {t(`seaState.${seaStateKey(hour.waveHsM)}`)} ({t('marine.hsLabel')} {round1(hour.waveHsM)} m{#if hour.wavePeriodS}, {t('marine.period')} {round1(hour.wavePeriodS)} s{/if}{#if hour.swellHsM != null}, {t('marine.swell')} {round1(hour.swellHsM)} m{/if})
	</div>
{/if}
