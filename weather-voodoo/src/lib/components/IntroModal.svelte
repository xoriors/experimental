<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';

	type Props = {
		onClose: () => void;
	};
	let { onClose }: Props = $props();

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKey} />

<div
	class="intro-backdrop"
	role="presentation"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose(); }}
>
	<div
		class="intro-card"
		role="dialog"
		aria-modal="true"
		aria-labelledby="intro-title"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		<h2 id="intro-title">{t('intro.title')}</h2>
		<p>{t('intro.body')}</p>
		<ul>
			<li>{@html t('intro.route')}</li>
			<li>{@html t('intro.fixed')}</li>
			<li>{t('intro.pickDuration')}</li>
		</ul>
		<p class="install-hint">{@html t('intro.installHint')}</p>
		<div class="intro-actions">
			<a class="btn-ghost" href="/help" onclick={onClose}>{t('intro.readHelp')}</a>
			<button type="button" class="btn" onclick={onClose}>{t('intro.gotIt')}</button>
		</div>
	</div>
</div>

<style>
	.intro-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 2000;
	}
	.intro-card {
		background: var(--bg-elev, var(--bg));
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1.2rem 1.4rem;
		max-width: 28rem;
		width: 100%;
		box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
	}
	.intro-card h2 {
		margin: 0 0 0.6rem 0;
		font-size: 1.15rem;
	}
	.intro-card p {
		margin: 0 0 0.7rem 0;
		line-height: 1.45;
	}
	.intro-card ul {
		padding-left: 1.1rem;
		margin: 0 0 1rem 0;
		line-height: 1.5;
	}
	.intro-card li {
		margin-bottom: 0.25rem;
	}
	.install-hint {
		font-size: 0.88em;
		color: var(--fg-dim);
		background: rgba(255, 255, 255, 0.05);
		padding: 0.5rem 0.7rem;
		border-radius: 8px;
		margin: 0 0 1rem 0;
	}
	.intro-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
</style>
