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
		background: rgba(255, 85, 85, 0.22);
		color: #ff8888;
	}
	.rw[data-cls='head-cross'] {
		background: rgba(180, 83, 9, 0.18);
		color: #d97706;
	}
	.rw[data-cls='cross'] {
		background: rgba(100, 116, 139, 0.18);
		color: #94a3b8;
	}
	.rw[data-cls='tail-cross'] {
		background: rgba(101, 163, 13, 0.18);
		color: #84cc16;
	}
	.rw[data-cls='tail'] {
		background: rgba(74, 222, 128, 0.25);
		color: #4ade80;
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
