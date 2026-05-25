<script lang="ts">
	import type { RelativeWindClass } from '$lib/wind';
	import { t } from '$lib/i18n/index.svelte';

	type Props = {
		relWindDeg: number;
		windKn: number;
		cls: RelativeWindClass;
		classLabel: string;
	};

	let { relWindDeg, windKn, cls, classLabel }: Props = $props();

	const CX = 75;
	const CY = 75;
	const R = 70;
	const RING = 16;
	const RI = R - RING / 2;
	const INNER_R = 24;

	function arc(startDeg: number, endDeg: number): string {
		const toRad = (d: number) => ((d - 90) * Math.PI) / 180;
		const x1 = CX + RI * Math.cos(toRad(startDeg));
		const y1 = CY + RI * Math.sin(toRad(startDeg));
		const x2 = CX + RI * Math.cos(toRad(endDeg));
		const y2 = CY + RI * Math.sin(toRad(endDeg));
		const large = endDeg - startDeg > 180 ? 1 : 0;
		return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${RI} ${RI} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
	}

	const zones: { start: number; end: number; color: string; id: RelativeWindClass }[] = [
		{ start: -30, end: 30, color: '#f87171', id: 'head' },
		{ start: 30, end: 60, color: '#fb923c', id: 'head-cross' },
		{ start: -60, end: -30, color: '#fb923c', id: 'head-cross' },
		{ start: 60, end: 120, color: '#94a3b8', id: 'cross' },
		{ start: -120, end: -60, color: '#94a3b8', id: 'cross' },
		{ start: 120, end: 150, color: '#a3e635', id: 'tail-cross' },
		{ start: -150, end: -120, color: '#a3e635', id: 'tail-cross' },
		{ start: 150, end: 210, color: '#22c55e', id: 'tail' }
	];

	const arrowAngle = $derived(relWindDeg + 180);

	const ARROW_START = INNER_R + 4;
	const ARROW_TIP = R - RING + 2;

	const COLORS: Record<RelativeWindClass, string> = {
		head: '#f87171',
		'head-cross': '#fb923c',
		cross: '#94a3b8',
		'tail-cross': '#a3e635',
		tail: '#22c55e'
	};

	const labelColor = $derived(COLORS[cls]);

	let showDetail = $state(false);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="wc-compass"
	onclick={() => (showDetail = !showDetail)}
	onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') showDetail = !showDetail; }}
	role="button"
	tabindex="0"
	aria-label="{classLabel} · {Math.round(windKn)} kn"
>
	<svg viewBox="0 0 150 150" aria-hidden="true">
		<!-- Dark background -->
		<circle cx={CX} cy={CY} r={R} fill="rgba(15, 23, 42, 0.92)" />

		<!-- Zone arcs — thick, bold -->
		{#each zones as z}
			<path
				d={arc(z.start, z.end)}
				stroke={z.color}
				stroke-width={RING}
				fill="none"
				stroke-linecap="butt"
				opacity={z.id === cls ? 1 : 0.3}
			/>
		{/each}

		<!-- Faint zone dividers -->
		{#each [-150, -120, -60, -30, 30, 60, 120, 150] as deg}
			{@const rad = (deg - 90) * Math.PI / 180}
			<line
				x1={CX + (RI - RING / 2) * Math.cos(rad)}
				y1={CY + (RI - RING / 2) * Math.sin(rad)}
				x2={CX + (RI + RING / 2) * Math.cos(rad)}
				y2={CY + (RI + RING / 2) * Math.sin(rad)}
				stroke="rgba(15, 23, 42, 0.8)"
				stroke-width="2"
			/>
		{/each}

		<!-- "YOU" heading triangle at top -->
		<polygon points="{CX},{CY - R + 2} {CX - 7},{CY - R + 12} {CX + 7},{CY - R + 12}"
			fill="white" opacity="0.95" />

		<!-- Wind arrow — bold, starts outside the speed zone -->
		<g transform="rotate({arrowAngle}, {CX}, {CY})" class="wc-arrow">
			<line
				x1={CX} y1={CY - ARROW_START}
				x2={CX} y2={CY - ARROW_TIP + 10}
				stroke="white"
				stroke-width="5"
				stroke-linecap="round"
			/>
			<polygon
				points="{CX},{CY - ARROW_TIP} {CX - 8},{CY - ARROW_TIP + 14} {CX + 8},{CY - ARROW_TIP + 14}"
				fill="white"
			/>
		</g>

		<!-- Center speed — big, bold, just the number -->
		<text x={CX} y={CY + 2} text-anchor="middle" dominant-baseline="central"
			fill="white" font-size="28" font-weight="800" font-family="system-ui, sans-serif"
			style="font-variant-numeric: tabular-nums;"
		>{Math.round(windKn)}</text>
	</svg>
	<div class="wc-class" style="color: {labelColor}">{classLabel}</div>
</div>

{#if showDetail}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="wc-detail-backdrop"
		onclick={() => (showDetail = false)}
		onkeydown={(e) => { if (e.key === 'Escape') showDetail = false; }}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="wc-detail" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="wc-detail-row">
				<span class="wc-detail-label">{t('wind.head')}/{t('wind.tail')}</span>
				<span class="wc-detail-value" style="color: {labelColor}">{classLabel}</span>
			</div>
			<div class="wc-detail-row">
				<span class="wc-detail-label">{t('table.windGust')}</span>
				<span class="wc-detail-value">{Math.round(windKn)} kn</span>
			</div>
			<div class="wc-detail-row">
				<span class="wc-detail-label">{t('windMap.verdict.relAngle')}</span>
				<span class="wc-detail-value">{Math.round(relWindDeg)}°</span>
			</div>
			<button type="button" class="btn-ghost wc-detail-close" onclick={() => (showDetail = false)}>OK</button>
		</div>
	</div>
{/if}

<style>
	.wc-compass {
		width: 150px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		filter: drop-shadow(0 3px 10px rgba(0, 0, 0, 0.65));
		cursor: pointer;
		user-select: none;
	}
	.wc-compass:focus-visible {
		outline: 2px solid #38bdf8;
		outline-offset: 4px;
		border-radius: 50%;
	}
	.wc-compass svg {
		width: 150px;
		height: 150px;
	}
	:global(.wc-arrow) {
		transition: transform 280ms ease;
	}
	.wc-class {
		font-size: 14px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.8px;
		text-align: center;
		padding: 3px 10px;
		background: rgba(15, 23, 42, 0.9);
		border-radius: 6px;
		line-height: 1;
	}
	.wc-detail-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1100;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 1rem;
		background: rgba(0, 0, 0, 0.4);
	}
	.wc-detail {
		background: var(--bg-elev, var(--bg, #1e293b));
		color: var(--fg, #e2e8f0);
		border: 1px solid var(--border, #334155);
		border-radius: 12px;
		padding: 0.8rem 1rem;
		width: 100%;
		max-width: 20rem;
		box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.4);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.wc-detail-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.92em;
	}
	.wc-detail-label {
		color: var(--fg-dim, #94a3b8);
		font-weight: 500;
	}
	.wc-detail-value {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.wc-detail-close {
		margin-top: 0.3rem;
		align-self: center;
		padding: 0.3rem 1rem;
	}
	@media (max-width: 720px) {
		.wc-compass {
			width: 130px;
		}
		.wc-compass svg {
			width: 130px;
			height: 130px;
		}
		.wc-class {
			font-size: 12px;
			padding: 2px 8px;
		}
	}
</style>
