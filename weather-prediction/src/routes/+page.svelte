<script lang="ts">
	import Tabs from '$lib/components/Tabs.svelte';
	import RouteView from '$lib/components/RouteView.svelte';
	import FixedView from '$lib/components/FixedView.svelte';
	import { view } from '$lib/state.svelte';
	import type { Tab } from '$lib/types';

	function onTab(t: Tab) {
		view.tab = t;
	}
</script>

<Tabs tab={view.tab} onChange={onTab} />

{#if view.tab === 'route'}
	<RouteView />
{:else}
	<FixedView />
{/if}
