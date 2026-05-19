<script lang="ts">
	import type { DayKey } from '$lib/types';

	let { day, onChange }: { day: DayKey; onChange: (d: DayKey) => void } = $props();

	const items: { key: DayKey; label: string }[] = [
		{ key: 'today', label: 'Today' },
		{ key: 'tomorrow', label: 'Tomorrow' },
		{ key: 'd2', label: 'Day after' }
	];
</script>

<div class="day-tabs" role="tablist">
	{#each items as item}
		<button
			class="day-tab"
			role="tab"
			aria-selected={day === item.key}
			onclick={() => onChange(item.key)}
		>
			{item.label}
		</button>
	{/each}
</div>
