<script lang="ts">
	import type { RelativeWindClass } from '$lib/wind';
	import { t } from '$lib/i18n/index.svelte';

	type Props = {
		relWindDeg: number;
		windKn: number;
		cls: RelativeWindClass;
		classLabel: string;
		onHide: () => void;
	};

	let { relWindDeg, windKn, cls, classLabel, onHide }: Props = $props();

	const CX = 80;
	const CY = 80;
	const R = 74;
	const RING = 18;
	const RI = R - RING / 2;
	const INNER_R = 26;

	function arc(startDeg: number, endDeg: number): string {
		const toRad = (d: number) => ((d - 90) * Math.PI) / 180;
		const x1 = CX + RI * Math.cos(toRad(startDeg));
		const y1 = CY + RI * Math.sin(toRad(startDeg));
		const x2 = CX + RI * Math.cos(toRad(endDeg));
		const y2 = CY + RI * Math.sin(toRad(endDeg));
		const large = endDeg - startDeg > 180 ? 1 : 0;
		return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${RI} ${RI} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
	}

	function labelPos(deg: number, r: number): { x: number; y: number } {
		const rad = (deg - 90) * Math.PI / 180;
		return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
	}

	const zones: { start: number; end: number; color: string; id: RelativeWindClass; label: string }[] = [
		{ start: -30, end: 30, color: '#ff5555', id: 'head', label: 'H' },
		{ start: 30, end: 60, color: '#b45309', id: 'head-cross', label: '' },
		{ start: -60, end: -30, color: '#b45309', id: 'head-cross', label: '' },
		{ start: 60, end: 120, color: '#64748b', id: 'cross', label: '×' },
		{ start: -120, end: -60, color: '#64748b', id: 'cross', label: '×' },
		{ start: 120, end: 150, color: '#65a30d', id: 'tail-cross', label: '' },
		{ start: -150, end: -120, color: '#65a30d', id: 'tail-cross', label: '' },
		{ start: 150, end: 210, color: '#4ade80', id: 'tail', label: 'T' }
	];

	const arrowAngle = $derived(relWindDeg + 180);

	const ARROW_START = INNER_R + 5;
	const ARROW_TIP = R - RING + 2;

	const COLORS: Record<RelativeWindClass, string> = {
		head: '#ff5555',
		'head-cross': '#b45309',
		cross: '#64748b',
		'tail-cross': '#65a30d',
		tail: '#4ade80'
	};

	const labelColor = $derived(COLORS[cls]);

	let showDetail = $state(false);
</script>

<div class="wc-wrap">
	<button
		type="button"
		class="wc-hide-btn"
		onclick={(e) => { e.stopPropagation(); onHide(); }}
		aria-label={t('windMap.hideCompass')}
		title={t('windMap.hideCompass')}
	>×</button>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="wc-compass"
		onclick={() => (showDetail = !showDetail)}
		onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') showDetail = !showDetail; }}
		role="button"
		tabindex="0"
		aria-label="{classLabel} · {Math.round(windKn)} kn"
	>
		<svg viewBox="0 0 160 160" aria-hidden="true">
			<defs>
				<filter id="arrow-glow">
					<feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="{labelColor}" flood-opacity="0.7" />
				</filter>
				<filter id="zone-glow">
					<feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="{labelColor}" flood-opacity="0.5" />
				</filter>
			</defs>

			<!-- Dark background -->
			<circle cx={CX} cy={CY} r={R} fill="rgba(15, 23, 42, 0.93)" />

			<!-- Inner glow matching active class -->
			<circle cx={CX} cy={CY} r={R - RING - 1} fill={labelColor} opacity="0.08" />

			<!-- Zone arcs — inactive very dim, active glows -->
			{#each zones as z}
				<path
					d={arc(z.start, z.end)}
					stroke={z.color}
					stroke-width={RING}
					fill="none"
					stroke-linecap="butt"
					opacity={z.id === cls ? 1 : 0.15}
					filter={z.id === cls ? 'url(#zone-glow)' : 'none'}
				/>
			{/each}

			<!-- Zone dividers -->
			{#each [-150, -120, -60, -30, 30, 60, 120, 150] as deg}
				{@const rad = (deg - 90) * Math.PI / 180}
				<line
					x1={CX + (RI - RING / 2) * Math.cos(rad)}
					y1={CY + (RI - RING / 2) * Math.sin(rad)}
					x2={CX + (RI + RING / 2) * Math.cos(rad)}
					y2={CY + (RI + RING / 2) * Math.sin(rad)}
					stroke="rgba(15, 23, 42, 0.85)"
					stroke-width="2"
				/>
			{/each}

			<!-- Zone labels on the ring -->
			{#each zones as z}
				{#if z.label}
					{@const mid = (z.start + z.end) / 2}
					{@const pos = labelPos(mid, RI)}
					<text
						x={pos.x} y={pos.y}
						text-anchor="middle" dominant-baseline="central"
						fill={z.id === cls ? '#fff' : z.color}
						font-size="11" font-weight="800"
						font-family="system-ui, sans-serif"
						opacity={z.id === cls ? 1 : 0.5}
					>{z.label}</text>
				{/if}
			{/each}

			<!-- "YOU" heading triangle at top -->
			<polygon points="{CX},{CY - R + 2} {CX - 7},{CY - R + 13} {CX + 7},{CY - R + 13}"
				fill="white" opacity="0.95" />

			<!-- Wind arrow — bold, glowing with the class color -->
			<g transform="rotate({arrowAngle}, {CX}, {CY})" class="wc-arrow" filter="url(#arrow-glow)">
				<line
					x1={CX} y1={CY - ARROW_START}
					x2={CX} y2={CY - ARROW_TIP + 12}
					stroke="white"
					stroke-width="5.5"
					stroke-linecap="round"
				/>
				<polygon
					points="{CX},{CY - ARROW_TIP} {CX - 9},{CY - ARROW_TIP + 16} {CX + 9},{CY - ARROW_TIP + 16}"
					fill="white"
				/>
			</g>

			<!-- Center speed — just the number, big -->
			<text x={CX} y={CY + 2} text-anchor="middle" dominant-baseline="central"
				fill="white" font-size="30" font-weight="900" font-family="system-ui, sans-serif"
				style="font-variant-numeric: tabular-nums;"
			>{Math.round(windKn)}</text>
		</svg>
		<div class="wc-class" style="color: {labelColor}; border-color: {labelColor}">{classLabel}</div>
	</div>
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
	.wc-wrap {
		position: relative;
	}
	.wc-hide-btn {
		all: unset;
		position: absolute;
		top: -4px;
		right: -4px;
		z-index: 2;
		width: 26px;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 15px;
		font-weight: 700;
		color: #94a3b8;
		background: rgba(15, 23, 42, 0.9);
		border: 1.5px solid rgba(148, 163, 184, 0.3);
		border-radius: 50%;
		cursor: pointer;
		line-height: 1;
	}
	.wc-hide-btn:hover {
		color: #fff;
		border-color: rgba(255, 255, 255, 0.4);
	}
	.wc-compass {
		width: 160px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.7));
		cursor: pointer;
		user-select: none;
	}
	.wc-compass:focus-visible {
		outline: 2px solid #38bdf8;
		outline-offset: 4px;
		border-radius: 50%;
	}
	.wc-compass svg {
		width: 160px;
		height: 160px;
	}
	:global(.wc-arrow) {
		transition: transform 280ms ease;
	}
	.wc-class {
		font-size: 14px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 1px;
		text-align: center;
		padding: 4px 12px;
		background: rgba(15, 23, 42, 0.92);
		border: 1.5px solid;
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
			width: 136px;
		}
		.wc-compass svg {
			width: 136px;
			height: 136px;
		}
		.wc-class {
			font-size: 12px;
			padding: 3px 9px;
		}
	}
</style>
