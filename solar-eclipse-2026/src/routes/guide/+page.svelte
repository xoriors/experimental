<script lang="ts">
	import { localCircumstances } from '$lib/eclipse/local';
	import { formatDuration } from '$lib/format';

	// Worked from the same maths as the rest of the site so the prose stays true.
	const palencia = localCircumstances({ lat: 42.0096, lon: -4.5288, elevation: 740 });
	const valencia = localCircumstances({ lat: 39.4699, lon: -0.3763, elevation: 15 });

	const futureEclipses = [
		{
			date: '2 August 2027',
			where: 'Spain (Cádiz, Málaga), Morocco, Algeria, Libya, Egypt, Saudi Arabia',
			detail:
				'The long one: up to 6m23s of totality near Luxor, with the Sun almost overhead. Southern Spain catches nearly three minutes.'
		},
		{
			date: '26 January 2028',
			where: 'Spain (annular), Portugal, Caribbean, Brazil',
			detail:
				'An annular eclipse — the Moon is too far away to cover the Sun, leaving a ring of light. Never safe to look at without a filter at any moment.'
		},
		{
			date: '12 August 2045',
			where: 'United States, Caribbean, South America',
			detail: 'The next great American eclipse, with over six minutes of totality.'
		}
	];
</script>

<svelte:head>
	<title>What to expect and how to plan — 2026 eclipse guide</title>
	<meta
		name="description"
		content="What a total solar eclipse actually looks and feels like, how to plan for 12 August 2026, photography advice for a Sun near the horizon, and the eclipses that follow."
	/>
</svelte:head>

<div class="shell">
	<h1>What to expect, and how to plan</h1>
	<p class="lede">
		People who have seen totality are unanimous and slightly tedious about it: it is not a bigger
		version of a partial eclipse, it is a different event. Here is what actually happens, in order,
		and what to do about it.
	</p>

	<h2>The hour before</h2>
	<p>
		First contact is undramatic. Through your filter a small notch appears on the Sun's edge, and for
		the next forty minutes very little seems to change. Your eye adapts to a falling light level
		almost perfectly, so even at 80 percent coverage the afternoon looks normal — perhaps oddly
		crisp, because the Sun has become a narrow crescent and is casting sharper shadows than usual.
	</p>
	<p>
		This is the phase people underestimate. Look at the ground under a leafy tree: every gap between
		leaves is a pinhole camera, and the dappled light turns into hundreds of crescents. It is one of
		the best parts of the whole thing and it is free.
	</p>

	<h2>The last five minutes</h2>
	<p>
		Now it moves quickly. The light goes strange — thin, silvery, with an unfamiliar colour cast that
		photographs never capture. The temperature drops noticeably. Birds settle. The western sky darkens
		in a way that does not look like sunset because it is happening in the wrong part of the sky and
		far too fast.
	</p>
	<p>
		In the last minute, if the ground is pale and the air steady, you may see <strong
			>shadow bands</strong
		> — faint ripples of light and dark racing across the ground, a few centimetres apart. They are an
		atmospheric effect and are notoriously hard to see; a white sheet laid out helps.
	</p>

	<h2>Totality</h2>
	<p>
		Second contact: the last of the photosphere breaks into <strong>Baily's beads</strong> as sunlight
		shines through valleys on the Moon's edge, then collapses to a single brilliant point — the
		<strong>diamond ring</strong> — and goes out.
	</p>
	<p>
		Then the corona. It is not white in the way a photograph suggests but pearly and structured, with
		streamers reaching out a solar diameter or more, and it is startlingly sharp-edged against a sky
		the colour of deep twilight. Around the Moon's rim, pink flecks: prominences, loops of hydrogen
		bigger than the Earth. Venus will be obvious high to the left of the Sun; Jupiter and Mercury sit
		close in, and Regulus is only about nine degrees away.
	</p>
	<p>
		From northern Spain there is a further oddity. Because the Sun is so low, you are looking at the
		corona through a great thickness of atmosphere and against a sky already coloured by sunset, and
		the whole horizon behind you glows orange — the light from outside the shadow, a couple of hundred
		kilometres away in every direction.
	</p>
	<p class="pull">
		Then it ends, without ceremony. Totality lasts {formatDuration(palencia.totalitySeconds)} at Palencia
		and only {formatDuration(valencia.totalitySeconds)} at Valencia. Filters back on the instant the
		first bead of light returns.
	</p>

	<h2>Planning, honestly</h2>
	<div class="grid grid-2">
		<div class="card">
			<h3>Be inside the path</h3>
			<p>
				Not near it. There is no partial credit. Check your exact spot in the
				<a href="/simulator">simulator</a> and give yourself several kilometres of margin from the limits.
			</p>
		</div>
		<div class="card">
			<h3>Stay mobile</h3>
			<p>
				The single most useful thing you can do is be willing to move on the morning. Book somewhere
				central to the path with roads in several directions rather than committing to one viewpoint.
			</p>
		</div>
		<div class="card">
			<h3>Check the western horizon</h3>
			<p>
				For Spain this matters as much as the sky overhead. Visit your site in advance, in daylight,
				and look towards where the Sun will be — around west-north-west.
			</p>
		</div>
		<div class="card">
			<h3>Expect crowds and traffic</h3>
			<p>
				Northern Spain in mid-August is already busy. Arrive early, bring water, and assume roads
				afterwards will be slow — everybody leaves at the same minute.
			</p>
		</div>
		<div class="card">
			<h3>Set your watch</h3>
			<p>
				Know your second and third contact times to the second and set an alarm a minute before.
				People routinely miss the diamond ring because they were looking at a screen.
			</p>
		</div>
		<div class="card">
			<h3>Have a cloud plan</h3>
			<p>
				Decide in advance what forecast would make you drive, and how far. Under thin cloud you will
				still get the darkness; under thick cloud you get nothing but the dark.
			</p>
		</div>
	</div>

	<h2>Photography, briefly</h2>
	<p>
		The honest advice for a first total eclipse is: do not. You get one attempt at something that
		lasts a minute, and pictures of this eclipse will be everywhere within the hour. If you do shoot:
	</p>
	<ul>
		<li>
			A front-mounted solar filter is mandatory for the partial phases and must come off for totality
			— practise the swap until it takes two seconds.
		</li>
		<li>
			Because the Sun is low, a wide shot with landscape is far more interesting than a tight one,
			and much easier. A 24–70 mm lens on a tripod will give you something no high-Sun eclipse can.
		</li>
		<li>
			For a close-up of the corona you need roughly 400 mm or more, and a bracket of exposures from
			about 1/1000 s to 1 second at f/8, ISO 400 — the corona's brightness range is enormous.
		</li>
		<li>Turn off autofocus, autoexposure and any flash. Focus manually on the Moon's edge beforehand.</li>
		<li>Set the camera running on an intervalometer and then look up with your own eyes.</li>
	</ul>

	<h2>Common questions</h2>
	<div class="faq">
		<details>
			<summary>Why is this called the first total eclipse over mainland Europe since 1999?</summary>
			<p>
				There have been total eclipses visible from European territory since — notably 20 March 2015
				over the Faroe Islands and Svalbard — but none whose path of totality crossed the European
				mainland. The last one to do that was 11 August 1999, which ran across Cornwall, northern
				France, Germany, Austria, Hungary and Romania.
			</p>
		</details>
		<details>
			<summary>Will it go completely dark?</summary>
			<p>
				Not quite. Totality is about as dark as deep twilight — you can still see your hands, read a
				watch face with difficulty, and the horizon glows in every direction because the shadow is
				only a few hundred kilometres wide. It is dark enough for the brighter planets and stars.
			</p>
		</details>
		<details>
			<summary>Why does the Moon appear to move across the Sun from one side to the other?</summary>
			<p>
				The Moon travels eastward against the background sky, roughly its own diameter every hour, so
				it always covers the Sun from west to east. Which way that looks to you — bottom-right first,
				or top-left — depends on how the horizon is tilted relative to the sky where you are, which
				is why the simulator rotates the geometry to match your latitude and the time of day.
			</p>
		</details>
		<details>
			<summary>Is a 99 percent partial eclipse nearly as good?</summary>
			<p>
				No, and this surprises people every time. The Sun's surface is so bright that one percent of
				it still outshines the corona by a factor of thousands. At 99 percent the sky is still blue,
				the corona is invisible, and you cannot take your filter off. Totality is a threshold, not a
				gradient.
			</p>
		</details>
		<details>
			<summary>How accurate are the times on this site?</summary>
			<p>
				The contact times come from NASA's own Besselian elements for this eclipse and agree with
				published predictions to within a few seconds. The main uncertainty is not the arithmetic but
				the Moon's ragged edge: near the northern and southern limits, mountains on the lunar limb
				shift the true boundary by a kilometre or two, which is why the simulator warns you when you
				are that close to an edge.
			</p>
		</details>
		<details>
			<summary>What if it is cloudy?</summary>
			<p>
				You still get the darkness, the temperature drop and the eeriness, which is more than
				nothing. But the corona is the point, so if the forecast is poor and you can move, move.
				Inland Castile and the Ebro valley are much drier than the Cantabrian coast.
			</p>
		</details>
	</div>

	<h2>If you miss it</h2>
	<p>Spain is unusually lucky over the next few years.</p>
	<ul class="future">
		{#each futureEclipses as eclipse (eclipse.date)}
			<li>
				<strong>{eclipse.date}</strong>
				<span class="where">{eclipse.where}</span>
				<p>{eclipse.detail}</p>
			</li>
		{/each}
	</ul>
</div>

<style>
	.shell {
		padding-bottom: 2rem;
	}

	h1,
	h2,
	p,
	ul:not(.future) {
		max-width: 70ch;
	}

	.pull {
		border-left: 3px solid var(--total);
		padding-left: 1rem;
		color: var(--text);
	}

	.grid h3 {
		margin-top: 0;
		font-size: 1rem;
	}

	.grid p {
		margin: 0;
		font-size: 0.92rem;
		color: var(--text-dim);
	}

	.faq {
		max-width: 70ch;
	}

	details {
		border-bottom: 1px solid var(--border);
		padding: 0.75rem 0;
	}

	summary {
		cursor: pointer;
		font-weight: 600;
	}

	summary:hover {
		color: var(--sun);
	}

	details p {
		margin: 0.6rem 0 0;
		color: var(--text-dim);
	}

	.future {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}

	.future li {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.9rem 1.1rem;
		background: var(--bg-card);
	}

	.future .where {
		display: block;
		color: var(--sun);
		font-size: 0.88rem;
		margin-top: 0.1rem;
	}

	.future p {
		margin: 0.4rem 0 0;
		color: var(--text-dim);
		font-size: 0.92rem;
	}
</style>
