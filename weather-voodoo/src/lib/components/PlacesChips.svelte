<script lang="ts">
	import { places, sortForDisplay, togglePin, removePlace, type SavedPlace } from '$lib/client/recentPlaces.svelte';
	import type { LabeledPoint } from '$lib/types';

	type Props = {
		onPick: (p: LabeledPoint) => void;
	};
	let { onPick }: Props = $props();

	const ordered = $derived(sortForDisplay(places.items));

	function shortLabel(label: string): string {
		const head = label.split(',')[0]?.trim();
		return head && head.length > 0 ? head : label;
	}

	function pick(p: SavedPlace) {
		onPick({ lat: p.lat, lon: p.lon, label: p.label });
	}
</script>

{#if ordered.length > 0}
	<div class="places-chips" role="list">
		{#each ordered as p (`${p.lat}-${p.lon}`)}
			<div class="chip" class:pinned={p.pinned} role="listitem">
				<button
					type="button"
					class="chip-main"
					title={p.label}
					onclick={() => pick(p)}
				>{shortLabel(p.label)}</button>
				<button
					type="button"
					class="chip-pin"
					title={p.pinned ? 'Unpin' : 'Pin so it stays in the list'}
					aria-label={p.pinned ? 'Unpin' : 'Pin'}
					onclick={() => togglePin(p)}
				>{p.pinned ? '★' : '☆'}</button>
				{#if !p.pinned}
					<button
						type="button"
						class="chip-del"
						title="Remove from recents"
						aria-label="Remove"
						onclick={() => removePlace(p)}
					>×</button>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.places-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}
	.chip {
		display: inline-flex;
		align-items: stretch;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--bg);
		overflow: hidden;
		font-size: 0.85em;
	}
	.chip.pinned {
		border-color: var(--good, #4ade80);
	}
	.chip button {
		background: transparent;
		color: var(--fg);
		border: none;
		font: inherit;
		cursor: pointer;
		padding: 0.25rem 0.6rem;
	}
	.chip button:hover {
		background: var(--bg-elev, rgba(255, 255, 255, 0.06));
	}
	.chip-main {
		max-width: 14rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip-pin {
		padding-left: 0.35rem !important;
		padding-right: 0.35rem !important;
		border-left: 1px solid var(--border);
		color: var(--fg-dim);
	}
	.chip.pinned .chip-pin {
		color: var(--good, #4ade80);
	}
	.chip-del {
		padding-left: 0.35rem !important;
		padding-right: 0.5rem !important;
		color: var(--fg-dim);
		border-left: 1px solid var(--border);
		font-size: 0.95em;
		line-height: 1;
	}
	.chip-del:hover {
		color: var(--unsafe, #ef4444);
	}
</style>
