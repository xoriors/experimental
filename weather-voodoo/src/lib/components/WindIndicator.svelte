<script lang="ts">
	import { classifyRelativeWind, type RelativeWindClass } from '$lib/wind';
	import { t } from '$lib/i18n/index.svelte';

	type Props = {
		/** Relative wind angle in [-180, 180]. 0 = head, ±180 = tail. */
		relWindDeg: number;
	};

	let { relWindDeg }: Props = $props();

	const cls = $derived(classifyRelativeWind(relWindDeg));

	// Where the wind GOES, relative to "up = direction of travel". The arrow
	// glyph (↑) is at 0° up; rotating by `relWindDeg + 180` makes a head wind
	// (relWindDeg=0) point ↓, a tail wind (±180) point ↑, etc.
	const arrowRot = $derived(relWindDeg + 180);

	const labelKey = $derived<Record<RelativeWindClass, string>>({
		head: 'wind.head',
		'head-cross': 'wind.headCross',
		cross: 'wind.cross',
		'tail-cross': 'wind.tailCross',
		tail: 'wind.tail'
	});

	const label = $derived(t(labelKey[cls]));
	const tooltip = $derived(t('wind.relativeTooltip', { cls: label, deg: Math.round(relWindDeg) }));
</script>

<span class="rw" data-cls={cls} title={tooltip} aria-label={tooltip}>
	<span class="rw-arrow" style="transform: rotate({arrowRot}deg);">↑</span>
	<span class="rw-label">{label}</span>
</span>

<style>
	.rw {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		margin-left: 0.35rem;
		padding: 0.02rem 0.35rem;
		border-radius: 4px;
		font-size: 0.82em;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
		vertical-align: 1px;
		white-space: nowrap;
	}
	.rw-arrow {
		display: inline-block;
		line-height: 1;
		transform-origin: 50% 50%;
	}
	.rw[data-cls='head'] {
		background: rgba(248, 113, 113, 0.18);
		color: #fca5a5;
	}
	.rw[data-cls='head-cross'] {
		background: rgba(251, 146, 60, 0.18);
		color: #fdba74;
	}
	.rw[data-cls='cross'] {
		background: rgba(148, 163, 184, 0.18);
		color: #cbd5e1;
	}
	.rw[data-cls='tail-cross'] {
		background: rgba(132, 204, 22, 0.2);
		color: #bef264;
	}
	.rw[data-cls='tail'] {
		background: rgba(34, 197, 94, 0.22);
		color: #86efac;
	}
	@media (max-width: 720px) {
		.rw {
			font-size: 0.78em;
			padding: 0.02rem 0.28rem;
		}
		.rw-label {
			display: none;
		}
	}
</style>
