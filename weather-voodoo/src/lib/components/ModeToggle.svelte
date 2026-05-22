<script lang="ts">
	import { view } from '$lib/state.svelte';
	import type { TripMode } from '$lib/types';

	function pick(m: TripMode) {
		view.tripMode = m;
	}
</script>

<div class="mode-toggle" class:mode-sea={view.tripMode === 'sea'} class:mode-land={view.tripMode === 'land'} role="radiogroup" aria-label="Trip mode">
	<button
		type="button"
		class="mode-btn mode-btn--land"
		role="radio"
		aria-checked={view.tripMode === 'land'}
		onclick={() => pick('land')}
	>
		<span class="mode-emoji" aria-hidden="true">🏞️</span>
		<span class="mode-label">Land</span>
		<span class="mode-hint">hike · sightsee · drive · photo</span>
	</button>
	<button
		type="button"
		class="mode-btn mode-btn--sea"
		role="radio"
		aria-checked={view.tripMode === 'sea'}
		onclick={() => pick('sea')}
	>
		<span class="mode-emoji" aria-hidden="true">🌊</span>
		<span class="mode-label">Sea</span>
		<span class="mode-hint">ferry · kayak · boat · swim</span>
	</button>
</div>

<style>
	.mode-toggle {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
		margin-bottom: 1rem;
	}
	.mode-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 0.85rem 0.6rem;
		border: 2px solid var(--border);
		border-radius: 10px;
		background: var(--bg-elev, rgba(255, 255, 255, 0.04));
		color: var(--fg-dim);
		cursor: pointer;
		font: inherit;
		transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease;
	}
	.mode-btn:hover {
		filter: brightness(1.15);
	}
	.mode-emoji {
		font-size: 1.6rem;
		line-height: 1;
	}
	.mode-label {
		font-weight: 600;
		font-size: 1.05rem;
		color: var(--fg);
	}
	.mode-hint {
		font-size: 0.75em;
		color: var(--fg-dim);
		opacity: 0.8;
	}
	.mode-btn[aria-checked='true'].mode-btn--sea {
		border-color: #38bdf8;
		background: rgba(56, 189, 248, 0.12);
		box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.4) inset;
	}
	.mode-btn[aria-checked='true'].mode-btn--sea .mode-label {
		color: #7dd3fc;
	}
	.mode-btn[aria-checked='true'].mode-btn--land {
		border-color: #4ade80;
		background: rgba(74, 222, 128, 0.12);
		box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.4) inset;
	}
	.mode-btn[aria-checked='true'].mode-btn--land .mode-label {
		color: #86efac;
	}
</style>
