<script lang="ts">
	import { defaultState } from '$lib/url-state';
	import { setView } from '$lib/state.svelte';
	import { browser } from '$app/environment';

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
	<title>Help · Weather Voodoo</title>
</svelte:head>

<article class="help">
	<h1>How Weather Voodoo works</h1>
	<p class="lede">
		It picks the best hours of the next 3 days for a specific outdoor or marine trip — by
		blending wind, gust, rain, wave height and visibility into a single 0–100 score, then
		surfacing the best contiguous windows that fit your time and duration.
	</p>

	<h2>The two tabs</h2>
	<ul>
		<li>
			<strong>Route</strong> — pick a <em>From</em> and <em>To</em>. The forecast is fused across 3 sample points along the line, taking the <em>worst-case</em> conditions hour-by-hour. Good for ferry/boat trips, drives, kayak crossings.
		</li>
		<li>
			<strong>Fixed location</strong> — one place. Good for a beach day, hike, sunset session.
		</li>
	</ul>

	<h2>The score</h2>
	<p>
		Each hour is scored 0–100 based on the activity type. The window score is the <em>worst hour</em> in the range (chain-as-strong-as-weakest-link); average score is the tiebreaker.
	</p>
	<ul>
		<li><strong>Sea mode</strong> — ferry/boat + kayaking verdicts dominate (wave, gust, visibility).</li>
		<li><strong>Land mode</strong> — sightseeing + hiking + photography verdicts (rain, wind, temp, visibility).</li>
		<li><strong>Auto</strong> — detected from how much marine data exists at the place; you can override.</li>
	</ul>

	<h2>The big controls</h2>
	<ul>
		<li><strong>Earliest / Latest start</strong> — restrict candidate start times of day. Defaults to 00:00–23:00 in 30-min steps.</li>
		<li><strong>Duration</strong> — how long you'll be out (1, 2, 3, 4, 6, 8, 12 h).</li>
		<li><strong>Day tabs</strong> — Today / Tomorrow / Day after. Each tab can override the global earliest/latest/duration/mode just for that day.</li>
	</ul>

	<h2>Reading the table</h2>
	<ul>
		<li><strong>Time</strong> — 3-hour blocks (00–03, 03–06, …) with a small score chip. Click a block to expand into 1-hour rows.</li>
		<li><strong>Temp</strong> — weather-condition icon + temperature in °C.</li>
		<li><strong>Wind / gust</strong> — sustained / peak in knots, with cardinal direction the wind is coming from.</li>
		<li><strong>Rain / Pₚ</strong> — mm/h + probability of precipitation.</li>
		<li><strong>Cloud / Vis / Wave</strong> — cloud %, visibility km, significant wave height (Hₛ) m.</li>
	</ul>

	<h2>Sunrise &amp; sunset</h2>
	<p>
		The "☀️ Sunrise · 🌙 Sunset" line above each day's table shows the day's times. Night-time rows are tinted darker; hours that straddle a transition get a 🌅 / 🌇 marker in the time cell.
	</p>

	<h2>Recommendations</h2>
	<p>
		Above the score-coloured "Best across 3 days" card, the <strong>1st &amp; 2nd best windows</strong> are highlighted per day. Click one to jump-highlight it in the table below.
	</p>

	<h2>Saved places</h2>
	<p>
		Picking a place via search or "📍 Use my location" saves it in a chip row under the inputs. ★ pins so it never gets evicted; × removes a recent (pinned ones can't be removed by accident).
	</p>

	<h2>Sharing &amp; resetting</h2>
	<ul>
		<li>The whole state lives in the URL hash — <strong>📋 Copy link</strong> or <strong>🔗 Share</strong> copies the exact view you're on.</li>
		<li><strong>↻ Reset</strong> (or clicking the 🌦️ logo) clears the current selection but <em>keeps</em> your saved places.</li>
	</ul>

	<h2>Tips</h2>
	<ul>
		<li>"Today" never proposes a window that already started — past hours still appear in the table with their scores, they're just not in the suggestions.</li>
		<li>All times are in your local timezone.</li>
		<li>The reference scale at the top of each day's table shows the good / caution / unsafe bands for each metric.</li>
	</ul>

	<div class="cta">
		<button type="button" class="btn" onclick={tryItOut}>Try a sample route</button>
		<a class="btn-ghost" href="/">Back to the app</a>
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
</style>
