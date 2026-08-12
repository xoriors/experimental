<script lang="ts">
	import { PARTIAL_PLACES, PATH_PLACES } from '$lib/data/places';
	import { localCircumstances } from '$lib/eclipse/local';
	import { compass, formatClock, formatDegrees, formatDuration, formatPercent } from '$lib/format';

	type Sort = 'duration' | 'cloud' | 'altitude' | 'name';
	let sort = $state<Sort>('duration');

	const pathRows = $derived.by(() => {
		const rows = PATH_PLACES.map((place) => {
			const local = localCircumstances({
				lat: place.lat,
				lon: place.lon,
				elevation: place.elevation
			});
			// A crude but honest combined score: totality is worthless under cloud,
			// and a Sun on the horizon is easily blocked by terrain.
			const clearOdds = 1 - (place.augustCloud ?? 0.4);
			const horizonPenalty = Math.min(1, Math.max(0.25, local.max.altitude / 12));
			return {
				place,
				local,
				clearOdds,
				score: local.totalitySeconds * clearOdds * horizonPenalty
			};
		});
		return rows.sort((a, b) => {
			if (sort === 'name') return a.place.name.localeCompare(b.place.name);
			if (sort === 'cloud') return (a.place.augustCloud ?? 1) - (b.place.augustCloud ?? 1);
			if (sort === 'altitude') return b.local.max.altitude - a.local.max.altitude;
			return b.local.totalitySeconds - a.local.totalitySeconds;
		});
	});

	const partialRows = $derived(
		PARTIAL_PLACES.map((place) => ({
			place,
			local: localCircumstances({ lat: place.lat, lon: place.lon, elevation: place.elevation })
		})).sort((a, b) => b.local.visibleObscuration - a.local.visibleObscuration)
	);

	const best = $derived([...pathRows].sort((a, b) => b.score - a.score).slice(0, 4));
</script>

<svelte:head>
	<title>Where to watch the 12 August 2026 eclipse</title>
	<meta
		name="description"
		content="City-by-city local times, totality durations, Sun altitude and August cloud climatology for the 12 August 2026 total solar eclipse in Iceland and Spain, plus what the rest of Europe sees."
	/>
</svelte:head>

<div class="shell">
	<h1>Where to watch</h1>
	<p class="lede">
		Choosing a spot for this eclipse is a three-way trade: how long totality lasts, how likely the sky
		is to be clear, and how high the Sun is — because a Sun sitting 4° above the horizon can be hidden
		by a low ridge, a building or a bank of sea fog that would not matter at all at midday.
	</p>

	<div class="note">
		<strong>Cloud figures here are climatology, not a forecast.</strong> They describe what August
		evenings are usually like. A day or two out, a real forecast beats any long-run average — and being
		willing to drive 100 km on the morning is worth more than any amount of planning.
	</div>

	<h2>The best compromises</h2>
	<p>
		Ranked by totality length, weighted by the historical chance of clear sky and penalised where the
		Sun is so low that terrain becomes a problem.
	</p>
	<div class="grid grid-2">
		{#each best as row (row.place.name)}
			<div class="card">
				<h3>{row.place.name}<small>{row.place.region}, {row.place.country}</small></h3>
				<div class="mini-stats">
					<span><b>{formatDuration(row.local.totalitySeconds)}</b><i>totality</i></span>
					<span><b>{formatDegrees(row.local.max.altitude, 0)}</b><i>Sun height</i></span>
					<span><b>{formatPercent(row.clearOdds, 0)}</b><i>usually clear</i></span>
				</div>
				{#if row.place.note}<p class="place-note">{row.place.note}</p>{/if}
			</div>
		{/each}
	</div>

	<h2>Everywhere in the path</h2>
	<div class="sorts">
		<span class="stat-label">Sort by</span>
		{#each [['duration', 'Totality'], ['cloud', 'Clear skies'], ['altitude', 'Sun height'], ['name', 'Name']] as option (option[0])}
			<button class:active={sort === option[0]} onclick={() => (sort = option[0] as Sort)}>
				{option[1]}
			</button>
		{/each}
	</div>

	<div class="table-scroll">
		<table>
			<thead>
				<tr>
					<th>Place</th>
					<th>Totality begins</th>
					<th class="num">Lasts</th>
					<th class="num">Sun height</th>
					<th>Looking</th>
					<th class="num">Usually clear</th>
				</tr>
			</thead>
			<tbody>
				{#each pathRows as row (row.place.name + row.place.country)}
					<tr>
						<td>
							<strong>{row.place.name}</strong>
							<small>{row.place.country}</small>
						</td>
						<td>
							{#if row.local.c2}
								{formatClock(row.local.c2.time, row.place.timeZone, true)}
								<small>local</small>
							{:else}
								—
							{/if}
						</td>
						<td class="num">{formatDuration(row.local.totalitySeconds)}</td>
						<td class="num" class:low={row.local.max.altitude < 6}>
							{formatDegrees(row.local.max.altitude)}
						</td>
						<td>{compass(row.local.max.azimuth)}</td>
						<td class="num">
							{row.place.augustCloud !== undefined
								? formatPercent(1 - row.place.augustCloud, 0)
								: '—'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<h2>How to read the Sun's height</h2>
	<div class="prose">
		<p>
			Along the Spanish leg the Sun drops from about 12° in Galicia to barely 2° over Menorca. As a
			rule of thumb, your fist at arm's length covers about 10° of sky, so in Valencia the eclipsed
			Sun will be less than half a fist above the horizon. That has practical consequences:
		</p>
		<ul>
			<li>
				Scout the western horizon in daylight first. A hill 5 km away that rises 400 m blocks
				everything below about 4.5°.
			</li>
			<li>
				Haze thickens enormously near the horizon. The corona will look dimmer and redder than the
				photographs you have seen from high-Sun eclipses.
			</li>
			<li>
				On the other hand, a low Sun makes for extraordinary photographs, with the eclipsed Sun and
				a landscape in the same frame — something you cannot do when it is overhead.
			</li>
			<li>
				The Sun sets shortly after totality in the east of Spain, so if cloud is on the western
				horizon there is no waiting it out.
			</li>
		</ul>
	</div>

	<h2>What the rest of Europe gets</h2>
	<p>
		Outside the path everyone still sees a partial eclipse — and in much of western Europe a very deep
		one. It will not go dark, and it is never safe to look at without a filter, but a 90 percent
		eclipse through eclipse glasses is a genuinely striking sight.
	</p>

	<div class="table-scroll">
		<table>
			<thead>
				<tr>
					<th>City</th>
					<th class="num">Sun covered</th>
					<th class="num">Magnitude</th>
					<th>Maximum at</th>
					<th class="num">Sun height</th>
				</tr>
			</thead>
			<tbody>
				{#each partialRows as row (row.place.name)}
					{@const best = row.local.bestVisible}
					<tr class:unseen={!row.local.hasEclipse || row.local.belowHorizon}>
						<td>
							<strong>{row.place.name}</strong>
							<small>{row.place.country}</small>
							{#if row.local.partlyBelowHorizon && !row.local.belowHorizon}
								<small class="flag" title="The Sun sets before the eclipse finishes">sets during</small>
							{/if}
						</td>
						<td class="num">
							{#if !row.local.hasEclipse || row.local.belowHorizon}
								—
							{:else}
								{formatPercent(row.local.visibleObscuration, 1)}
							{/if}
						</td>
						<td class="num">
							{#if !row.local.hasEclipse || row.local.belowHorizon}
								—
							{:else}
								{row.local.visibleMagnitude.toFixed(3)}
							{/if}
						</td>
						<td>
							{#if !row.local.hasEclipse}
								not visible
							{:else if row.local.belowHorizon}
								below the horizon throughout
							{:else if best}
								{formatClock(best.time, row.place.timeZone, false)} local
							{:else}
								—
							{/if}
						</td>
						<td class="num" class:low={best !== null && best.altitude < 6}>
							{best ? formatDegrees(best.altitude) : '—'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<p class="footnote">
		Figures are for the deepest moment that is <em>actually above the horizon</em>. This eclipse
		happens around sunset over much of Europe, and further east it finishes after the Sun has gone:
		Bucharest, for instance, reaches 90% on paper but sees barely a nibble before sunset, so the
		geometric maximum would be badly misleading. "Sun covered" is the fraction of the Sun's
		<em>area</em> hidden, which is what governs how much the light drops. "Magnitude" is the fraction
		of its <em>diameter</em> covered — the figure usually quoted, and always the larger of the two. Times are computed for the city centre; move a few
		kilometres and they shift by a few seconds.
	</p>

	<div class="note note-danger">
		A 99 percent partial eclipse is not "almost totality". The remaining sliver of photosphere is
		still thousands of times brighter than the corona, the sky stays blue, and you must keep your
		filter on the whole time. The difference between 99 percent and 100 percent is the entire
		experience. <a href="/safety">Eye safety</a>
	</div>
</div>

<style>
	.mini-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem 1.25rem;
		margin: 0.5rem 0;
	}

	.mini-stats span {
		display: flex;
		flex-direction: column;
	}

	.mini-stats b {
		font-size: 1.3rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
		white-space: nowrap;
	}

	.mini-stats i {
		font-style: normal;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-faint);
	}

	h3 small {
		display: block;
		font-weight: 400;
		font-size: 0.82rem;
		color: var(--text-faint);
		margin-top: 0.15rem;
	}

	.place-note {
		font-size: 0.88rem;
		color: var(--text-dim);
		margin: 0;
	}

	.sorts {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.sorts button {
		font-size: 0.84rem;
		padding: 0.25rem 0.6rem;
	}

	td small {
		color: var(--text-faint);
		font-size: 0.78rem;
		margin-left: 0.3rem;
	}

	td.low {
		color: var(--sun);
	}

	tr.unseen td {
		color: var(--text-faint);
	}

	small.flag {
		display: inline-block;
		margin-left: 0.35rem;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		font-size: 0.7rem;
		color: var(--sun);
		cursor: help;
	}

	.footnote {
		font-size: 0.85rem;
		color: var(--text-faint);
		max-width: 75ch;
		margin-top: 0.75rem;
	}
</style>
