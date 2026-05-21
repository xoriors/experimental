<script lang="ts">
	import type { DayKey } from '$lib/types';

	let { day, onChange }: { day: DayKey; onChange: (d: DayKey) => void } = $props();

	function dayOfMonth(offset: number): number {
		const d = new Date();
		d.setDate(d.getDate() + offset);
		return d.getDate();
	}

	const items = $derived<{ key: DayKey; label: string; date: number }[]>([
		{ key: 'today', label: 'Today', date: dayOfMonth(0) },
		{ key: 'tomorrow', label: 'Tomorrow', date: dayOfMonth(1) },
		{ key: 'd2', label: 'Day after', date: dayOfMonth(2) }
	]);
</script>

<div class="day-tabs" role="tablist">
	{#each items as item}
		<button
			class="day-tab"
			role="tab"
			aria-selected={day === item.key}
			onclick={() => onChange(item.key)}
		>
			{item.label} <span class="day-num">{item.date}</span>
		</button>
	{/each}
</div>

<style>
	.day-num {
		opacity: 0.7;
		font-variant-numeric: tabular-nums;
		margin-left: 0.15rem;
	}
</style>
