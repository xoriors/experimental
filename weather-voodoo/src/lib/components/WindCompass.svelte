<script lang="ts">
	import type { RelativeWindClass } from '$lib/wind';

	type Props = {
		relWindDeg: number;
		windKn: number;
		cls: RelativeWindClass;
		classLabel: string;
	};

	let { relWindDeg, windKn, cls, classLabel }: Props = $props();

	const CX = 70;
	const CY = 70;
	const R = 62;
	const RING = 11;
	const RI = R - RING / 2;
	const INNER_R = 22;

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
	const ARROW_END = R - RING - 2;
	const HEAD_LEN = 10;

	const COLORS: Record<RelativeWindClass, string> = {
		head: '#f87171',
		'head-cross': '#fb923c',
		cross: '#94a3b8',
		'tail-cross': '#a3e635',
		tail: '#22c55e'
	};

	const labelColor = $derived(COLORS[cls]);
</script>

<div class="wc-compass" title="{classLabel} · {Math.round(windKn)} kn · {Math.round(relWindDeg)}° relative">
	<svg viewBox="0 0 140 140" aria-hidden="true">
		<!-- Dark background -->
		<circle cx={CX} cy={CY} r={R} fill="rgba(15, 23, 42, 0.92)" />

		<!-- Zone arcs -->
		{#each zones as z}
			<path
				d={arc(z.start, z.end)}
				stroke={z.color}
				stroke-width={RING}
				fill="none"
				stroke-linecap="butt"
				opacity={z.id === cls ? 1 : 0.35}
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
				stroke="rgba(15, 23, 42, 0.7)"
				stroke-width="1.5"
			/>
		{/each}

		<!-- "YOU" heading triangle at top -->
		<polygon points="{CX},{CY - R + 1} {CX - 6},{CY - R + 10} {CX + 6},{CY - R + 10}"
			fill="white" opacity="0.9" />

		<!-- Wind arrow — starts OUTSIDE the speed text zone, never covers the number -->
		<g transform="rotate({arrowAngle}, {CX}, {CY})" class="wc-arrow">
			<line
				x1={CX} y1={CY - ARROW_START}
				x2={CX} y2={CY - ARROW_END}
				stroke="white"
				stroke-width="3.5"
				stroke-linecap="round"
			/>
			<polygon
				points="{CX},{CY - ARROW_END - HEAD_LEN / 2} {CX - 6},{CY - ARROW_END + HEAD_LEN / 2} {CX + 6},{CY - ARROW_END + HEAD_LEN / 2}"
				fill="white"
			/>
		</g>

		<!-- Center speed — inside the inner zone, always readable -->
		<text x={CX} y={CY + 1} text-anchor="middle" dominant-baseline="central"
			fill="white" font-size="22" font-weight="800" font-family="system-ui, sans-serif"
			style="font-variant-numeric: tabular-nums;"
		>{Math.round(windKn)}<tspan font-size="11" font-weight="600" opacity="0.8">kn</tspan></text>
	</svg>
	<div class="wc-class" style="color: {labelColor}">{classLabel}</div>
</div>

<style>
	.wc-compass {
		width: 140px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.6));
		cursor: help;
		user-select: none;
	}
	.wc-compass svg {
		width: 140px;
		height: 140px;
	}
	:global(.wc-arrow) {
		transition: transform 280ms ease;
	}
	.wc-class {
		font-size: 13px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.8px;
		text-align: center;
		padding: 3px 10px;
		background: rgba(15, 23, 42, 0.9);
		border-radius: 6px;
		line-height: 1;
	}
	@media (max-width: 720px) {
		.wc-compass {
			width: 120px;
		}
		.wc-compass svg {
			width: 120px;
			height: 120px;
		}
		.wc-class {
			font-size: 11px;
			padding: 2px 8px;
		}
	}
</style>
