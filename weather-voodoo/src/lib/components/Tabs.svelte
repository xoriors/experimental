<script lang="ts">
	import type { Tab } from '$lib/types';
	import { t } from '$lib/i18n/index.svelte';

	let { tab, onChange }: { tab: Tab; onChange: (t: Tab) => void } = $props();
</script>

<div class="tab-bar" role="tablist">
	<button class="tab" role="tab" aria-selected={tab === 'fixed'} onclick={() => onChange('fixed')}>
		{t('tabs.fixed')}
	</button>
	<button class="tab" role="tab" aria-selected={tab === 'route'} onclick={() => onChange('route')}>
		{t('tabs.route')}
	</button>
	<button class="tab" role="tab" aria-selected={tab === 'waypoints'} onclick={() => onChange('waypoints')}>
		{t('tabs.waypoints')}
	</button>
</div>
