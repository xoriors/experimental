<script lang="ts">
	import type { Tab } from '$lib/types';

	let { tab, onChange }: { tab: Tab; onChange: (t: Tab) => void } = $props();
</script>

<div class="tab-bar" role="tablist">
	<button class="tab" role="tab" aria-selected={tab === 'route'} onclick={() => onChange('route')}>
		Route
	</button>
	<button class="tab" role="tab" aria-selected={tab === 'fixed'} onclick={() => onChange('fixed')}>
		Fixed location
	</button>
</div>
