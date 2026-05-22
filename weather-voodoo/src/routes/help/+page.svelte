<script lang="ts">
	import { defaultState } from '$lib/url-state';
	import { setView } from '$lib/state.svelte';
	import { browser } from '$app/environment';
	import { t } from '$lib/i18n/index.svelte';

	function tryItOut() {
		setView({
			...defaultState(),
			tab: 'route',
			from: { lat: 7.7388, lon: 98.7784, label: 'Phi Phi Islands' },
			to: { lat: 8.034, lon: 98.825, label: 'Ao Nang' }
		});
		if (browser) window.location.href = '/';
	}
</script>

<svelte:head>
	<title>{t('helpPage.docTitle')}</title>
</svelte:head>

<article class="help">
	<p class="back-top">
		<a href="/">{t('helpPage.back')}</a>
	</p>
	<h1>{t('helpPage.title')}</h1>
	<p class="lede">{t('helpPage.lede')}</p>

	<h2>{t('helpPage.twoTabs')}</h2>
	<ul>
		<li>{@html t('helpPage.routeDesc')}</li>
		<li>{@html t('helpPage.fixedDesc')}</li>
	</ul>

	<h2>{t('helpPage.score')}</h2>
	<p>{@html t('helpPage.scoreDesc')}</p>
	<ul>
		<li>{@html t('helpPage.scoreSea')}</li>
		<li>{@html t('helpPage.scoreLand')}</li>
	</ul>

	<h2>{t('helpPage.bigControls')}</h2>
	<ul>
		<li>{@html t('helpPage.ctrlEarliest')}</li>
		<li>{@html t('helpPage.ctrlDuration')}</li>
		<li>{@html t('helpPage.ctrlDayTabs')}</li>
	</ul>

	<h2>{t('helpPage.readingTable')}</h2>
	<ul>
		<li>{@html t('helpPage.tblTime')}</li>
		<li>{@html t('helpPage.tblTemp')}</li>
		<li>{@html t('helpPage.tblWind')}</li>
		<li>{@html t('helpPage.tblRain')}</li>
		<li>{@html t('helpPage.tblCloud')}</li>
	</ul>

	<h2>{t('helpPage.sunHeading')}</h2>
	<p>{t('helpPage.sunDesc')}</p>

	<h2>{t('helpPage.recommendations')}</h2>
	<p>{@html t('helpPage.recommendationsDesc')}</p>

	<h2>{t('helpPage.savedPlaces')}</h2>
	<p>{t('helpPage.savedPlacesDesc')}</p>

	<h2>{t('helpPage.sharingHeading')}</h2>
	<ul>
		<li>{@html t('helpPage.shareLink')}</li>
		<li>{@html t('helpPage.shareReset')}</li>
	</ul>

	<h2>{t('helpPage.installHeading')}</h2>
	<p>{t('helpPage.installDesc')}</p>
	<ul>
		<li>{@html t('helpPage.installIos')}</li>
		<li>{@html t('helpPage.installAndroid')}</li>
		<li>{@html t('helpPage.installDesktop')}</li>
	</ul>

	<h2>{t('helpPage.tips')}</h2>
	<ul>
		<li>{t('helpPage.tip1')}</li>
		<li>{t('helpPage.tip2')}</li>
		<li>{t('helpPage.tip3')}</li>
	</ul>

	<div class="cta">
		<button type="button" class="btn" onclick={tryItOut}>{t('helpPage.tryRoute')}</button>
		<a class="btn-ghost" href="/">{t('helpPage.backBtn')}</a>
	</div>
</article>

<style>
	.help {
		max-width: 760px;
		margin: 0 auto;
		line-height: 1.55;
	}
	.help h1 {
		font-size: 1.6rem;
		margin: 0 0 0.5rem;
	}
	.help h2 {
		font-size: 1.05rem;
		margin: 1.4rem 0 0.4rem;
		color: var(--fg);
	}
	.lede {
		color: var(--fg-dim);
		font-size: 1.02rem;
	}
	.help ul {
		padding-left: 1.2rem;
		margin: 0.3rem 0 0.8rem;
	}
	.help li {
		margin-bottom: 0.3rem;
	}
	.cta {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 1.6rem;
	}
	.back-top {
		margin: 0 0 0.6rem;
		font-size: 0.9em;
	}
	.back-top a {
		color: var(--fg-dim);
		text-decoration: none;
	}
	.back-top a:hover {
		color: var(--fg);
	}
</style>
