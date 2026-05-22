<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';

	let { onReset }: { onReset?: () => void } = $props();
	let toast = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function show(msg: string) {
		toast = msg;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => (toast = null), 2200);
	}

	async function copy() {
		if (typeof window === 'undefined') return;
		const url = window.location.href;
		try {
			await navigator.clipboard.writeText(url);
			show(t('share.linkCopied'));
		} catch {
			const input = document.createElement('input');
			input.value = url;
			document.body.appendChild(input);
			input.select();
			try {
				document.execCommand('copy');
				show(t('share.linkCopied'));
			} catch {
				show(t('share.copyFailed'));
			}
			document.body.removeChild(input);
		}
	}

	async function share() {
		if (typeof navigator === 'undefined' || !('share' in navigator)) {
			await copy();
			return;
		}
		try {
			await navigator.share({
				title: t('share.weatherForecast'),
				text: t('share.forecastView'),
				url: window.location.href
			});
		} catch {
			// user cancelled
		}
	}
</script>

<div class="share-bar">
	{#if onReset}
		<button
			class="btn-ghost"
			onclick={() => {
				onReset?.();
				show(t('share.resetDone'));
			}}
			title={t('share.clearAll')}
		>{t('share.reset')}</button>
	{/if}
	<button class="btn-ghost" onclick={copy} title={t('share.copyTitle')}>{t('share.copy')}</button>
	<button class="btn" onclick={share} title={t('share.shareTitle')}>{t('share.share')}</button>
</div>

{#if toast}
	<div class="toast" role="status">{toast}</div>
{/if}
