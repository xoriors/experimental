<script lang="ts">
	import { view } from '$lib/state.svelte';
	import { LOCALES, LOCALE_NAMES, setLocale, t, type Locale } from '$lib/i18n/index.svelte';

	function onChange(e: Event) {
		const next = (e.target as HTMLSelectElement).value as Locale;
		view.locale = next;
		setLocale(next);
	}
</script>

<label class="lang" title={t('language')}>
	<span class="globe" aria-hidden="true">🌐</span>
	<select value={view.locale} onchange={onChange} aria-label={t('language')}>
		{#each LOCALES as l}
			<option value={l}>{LOCALE_NAMES[l]}</option>
		{/each}
	</select>
</label>

<style>
	.lang {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.lang select {
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.35rem 0.45rem;
		font: inherit;
		font-size: 0.9em;
		cursor: pointer;
	}
	.lang select option {
		background: var(--bg-elev);
		color: var(--fg);
	}
	.globe {
		font-size: 1em;
	}
	@media (max-width: 720px) {
		.lang select {
			padding: 0.3rem 0.35rem;
			font-size: 0.85em;
		}
	}
</style>
