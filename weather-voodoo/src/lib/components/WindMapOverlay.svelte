<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';

	type Props = {
		/** All hour timestamps (ISO local) available to scrub through. */
		hourTimes: string[];
		/** Currently selected hour (must be in hourTimes). */
		selectedTime: string;
		/** "Now" hour (the first hourTimes entry that is >= now). */
		nowTime: string | null;
		timezone?: string;
		/** Optional one-line forecast verdict from the parent. */
		verdict?: string;
		onSelect: (time: string) => void;
	};

	let { hourTimes, selectedTime, nowTime, timezone, verdict, onSelect }: Props = $props();

	const idx = $derived(hourTimes.indexOf(selectedTime));
	const canPrev = $derived(idx > 0);
	const canNext = $derived(idx >= 0 && idx < hourTimes.length - 1);
	const isNow = $derived(selectedTime === nowTime);

	function fmtLabel(iso: string): string {
		if (!iso) return '';
		const d = new Date(iso + ':00Z');
		if (Number.isNaN(d.getTime())) {
			const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
			if (!m) return iso;
			return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
		}
		// Use the iso strings directly — they're already in destination tz.
		const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
		if (!m) return iso;
		const dayName = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`).toLocaleDateString(undefined, {
			weekday: 'short'
		});
		return `${dayName.toUpperCase()} ${m[4]}:${m[5]}`;
	}

	function step(dir: -1 | 1) {
		const j = idx + dir;
		if (j >= 0 && j < hourTimes.length) onSelect(hourTimes[j]);
	}

	function jumpToNow() {
		if (nowTime) onSelect(nowTime);
	}
</script>

<div
	class="wm-overlay"
	role="group"
	aria-label={t('windMap.regionLabel')}
>
	<div class="wm-pill">
		<button
			type="button"
			class="wm-step"
			disabled={!canPrev}
			onclick={(e) => {
				e.stopPropagation();
				step(-1);
			}}
			aria-label={t('windMap.prevHour')}
			title={t('windMap.prevHour')}
		>
			◀
		</button>
		<button
			type="button"
			class="wm-label"
			onclick={(e) => {
				e.stopPropagation();
				jumpToNow();
			}}
			class:is-now={isNow}
			title={isNow ? t('windMap.nowTitle') : t('windMap.jumpNowTitle')}
		>
			{#if isNow}
				<span class="wm-now-badge">{t('windMap.now')}</span>
			{/if}
			<span class="wm-time">{fmtLabel(selectedTime)}</span>
			{#if timezone}
				<span class="wm-tz">{timezone}</span>
			{/if}
		</button>
		<button
			type="button"
			class="wm-step"
			disabled={!canNext}
			onclick={(e) => {
				e.stopPropagation();
				step(1);
			}}
			aria-label={t('windMap.nextHour')}
			title={t('windMap.nextHour')}
		>
			▶
		</button>
	</div>
	{#if verdict}
		<div class="wm-verdict" aria-live="polite">{verdict}</div>
	{/if}
</div>

<style>
	.wm-overlay {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		pointer-events: none;
		z-index: 12;
		max-width: calc(100% - 100px); /* leave room for map controls */
	}
	.wm-overlay > * {
		pointer-events: auto;
	}
	.wm-pill {
		display: flex;
		align-items: stretch;
		background: rgba(15, 23, 42, 0.88);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 999px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
		overflow: hidden;
	}
	.wm-step {
		all: unset;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 48px;
		min-height: 48px;
		font-size: 1rem;
		color: #fff;
		cursor: pointer;
		opacity: 0.95;
		transition: background 120ms ease, opacity 120ms ease;
	}
	.wm-step:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.08);
	}
	.wm-step:active:not(:disabled) {
		background: rgba(255, 255, 255, 0.16);
	}
	.wm-step:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.wm-step:focus-visible {
		outline: 2px solid #38bdf8;
		outline-offset: -2px;
	}
	.wm-label {
		all: unset;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4px 12px;
		min-width: 130px;
		min-height: 48px;
		color: #fff;
		line-height: 1.05;
		text-align: center;
		transition: background 120ms ease;
	}
	.wm-label:hover {
		background: rgba(255, 255, 255, 0.06);
	}
	.wm-label.is-now {
		background: rgba(34, 197, 94, 0.18);
	}
	.wm-label:focus-visible {
		outline: 2px solid #38bdf8;
		outline-offset: -2px;
	}
	.wm-now-badge {
		display: inline-block;
		padding: 1px 7px;
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0.8px;
		background: #22c55e;
		color: #052e16;
		border-radius: 4px;
		margin-bottom: 2px;
	}
	.wm-time {
		font-size: 15px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.3px;
	}
	.wm-tz {
		font-size: 10px;
		opacity: 0.65;
		margin-top: 1px;
		letter-spacing: 0.2px;
	}
	.wm-verdict {
		background: rgba(15, 23, 42, 0.85);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		color: #e2e8f0;
		font-size: 12px;
		font-weight: 500;
		padding: 5px 12px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		max-width: 100%;
		text-align: center;
		line-height: 1.3;
	}
	@media (max-width: 720px) {
		.wm-overlay {
			top: 8px;
			gap: 6px;
		}
		.wm-step {
			min-width: 44px;
			min-height: 44px;
		}
		.wm-label {
			min-width: 110px;
			min-height: 44px;
			padding: 3px 10px;
		}
		.wm-time {
			font-size: 13px;
		}
		.wm-tz {
			display: none;
		}
	}
</style>
