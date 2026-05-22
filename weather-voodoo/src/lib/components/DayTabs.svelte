<script lang="ts">
	import type { DayKey } from '$lib/types';
	import { t } from '$lib/i18n/index.svelte';

	let { day, onChange }: { day: DayKey; onChange: (d: DayKey) => void } = $props();

	let bar: HTMLDivElement | undefined = $state.raw();

	$effect(() => {
		const el = bar;
		if (!el || typeof document === 'undefined') return;
		const sync = () => {
			document.documentElement.style.setProperty('--day-tabs-h', `${el.offsetHeight}px`);
		};
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		return () => {
			ro.disconnect();
			document.documentElement.style.removeProperty('--day-tabs-h');
		};
	});

	function dayOfMonth(offset: number): number {
		const d = new Date();
		d.setDate(d.getDate() + offset);
		return d.getDate();
	}

	const items = $derived<{ key: DayKey; label: string; date: number }[]>([
		{ key: 'today', label: t('days.today'), date: dayOfMonth(0) },
		{ key: 'tomorrow', label: t('days.tomorrow'), date: dayOfMonth(1) },
		{ key: 'd2', label: t('days.d2'), date: dayOfMonth(2) }
	]);
</script>

<div class="day-tabs" role="tablist" bind:this={bar}>
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
