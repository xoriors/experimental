<script lang="ts">
	import Tabs from '$lib/components/Tabs.svelte';
	import ModeToggle from '$lib/components/ModeToggle.svelte';
	import RouteView from '$lib/components/RouteView.svelte';
	import FixedView from '$lib/components/FixedView.svelte';
	import WaypointsView from '$lib/components/WaypointsView.svelte';
	import { view } from '$lib/state.svelte';
	import type { Tab } from '$lib/types';

	function onTab(t: Tab) {
		view.tab = t;
	}
</script>

<ModeToggle />

<Tabs tab={view.tab} onChange={onTab} />

{#if view.tab === 'route'}
	<RouteView />
{:else if view.tab === 'waypoints'}
	<WaypointsView />
{:else}
	<FixedView />
{/if}
