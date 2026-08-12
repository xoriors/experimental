<script lang="ts">
	import { ALL_PLACES, type Place } from '$lib/data/places';
	import { searchPlaces, roughDistanceKm, type GeocodedPlace } from '$lib/data/geocode';
	import { summariseVisibility, type VisibilitySummary } from '$lib/eclipse/summary';

	interface Props {
		lat: number;
		lon: number;
		elevation: number;
		label: string;
		onchange: (place: { lat: number; lon: number; elevation: number; label: string }) => void;
	}

	let { lat, lon, elevation, label, onchange }: Props = $props();

	interface Suggestion {
		key: string;
		name: string;
		detail: string;
		lat: number;
		lon: number;
		elevation: number;
		/** Curated entries are on the recommended list and come with local notes. */
		curated: boolean;
		summary: VisibilitySummary;
	}

	let query = $state('');
	let remote = $state<GeocodedPlace[]>([]);
	let searching = $state(false);
	let searchError = $state('');
	let geolocating = $state(false);
	let geoError = $state('');
	let open = $state(false);
	let highlighted = $state(-1);

	let controller: AbortController | null = null;
	let debounce: ReturnType<typeof setTimeout> | null = null;

	function toSuggestion(place: Place): Suggestion {
		return {
			key: `local:${place.name}:${place.country}`,
			name: place.name,
			detail: [place.region, place.country].filter(Boolean).join(', '),
			lat: place.lat,
			lon: place.lon,
			elevation: place.elevation,
			curated: true,
			summary: summariseVisibility(place.lat, place.lon, place.elevation)
		};
	}

	function fromGeocoded(place: GeocodedPlace): Suggestion {
		return {
			key: `remote:${place.id}`,
			name: place.name,
			detail: [place.admin, place.country].filter(Boolean).join(', '),
			lat: place.lat,
			lon: place.lon,
			elevation: place.elevation,
			curated: false,
			summary: summariseVisibility(place.lat, place.lon, place.elevation)
		};
	}

	const localMatches = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (needle.length < 2) return [] as Suggestion[];
		return ALL_PLACES.filter((place) =>
			`${place.name} ${place.region} ${place.country}`.toLowerCase().includes(needle)
		)
			.slice(0, 5)
			.map(toSuggestion);
	});

	// Remote hits that duplicate something already listed locally are dropped:
	// the curated entry carries the better description.
	const suggestions = $derived.by(() => {
		const locals = localMatches;
		const extra = remote
			.map(fromGeocoded)
			.filter((candidate) => !locals.some((l) => roughDistanceKm(l, candidate) < 25));
		return [...locals, ...extra];
	});

	$effect(() => {
		const needle = query.trim();
		if (debounce) clearTimeout(debounce);
		if (needle.length < 2) {
			controller?.abort();
			remote = [];
			searching = false;
			searchError = '';
			return;
		}
		// Debounced so a burst of keystrokes makes one request, not eight.
		debounce = setTimeout(() => {
			controller?.abort();
			controller = new AbortController();
			searching = true;
			searchError = '';
			searchPlaces(needle, controller.signal)
				.then((results) => {
					remote = results;
					searching = false;
				})
				.catch((error: unknown) => {
					if (error instanceof DOMException && error.name === 'AbortError') return;
					remote = [];
					searching = false;
					searchError =
						'Worldwide search is unavailable — showing listed places only. You can still type coordinates below.';
				});
		}, 280);

		return () => {
			if (debounce) clearTimeout(debounce);
		};
	});

	function choose(suggestion: Suggestion) {
		query = '';
		remote = [];
		open = false;
		highlighted = -1;
		onchange({
			lat: suggestion.lat,
			lon: suggestion.lon,
			elevation: suggestion.elevation,
			label: `${suggestion.name}${suggestion.detail ? ', ' + suggestion.detail.split(', ').pop() : ''}`
		});
	}

	function onKeydown(event: KeyboardEvent) {
		if (!suggestions.length) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			highlighted = (highlighted + 1) % suggestions.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			highlighted = (highlighted - 1 + suggestions.length) % suggestions.length;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			choose(suggestions[highlighted >= 0 ? highlighted : 0]);
		} else if (event.key === 'Escape') {
			open = false;
		}
	}

	function locate() {
		if (!navigator.geolocation) {
			geoError = 'This browser cannot report your location.';
			return;
		}
		geolocating = true;
		geoError = '';
		navigator.geolocation.getCurrentPosition(
			(position) => {
				geolocating = false;
				onchange({
					lat: position.coords.latitude,
					lon: position.coords.longitude,
					elevation: position.coords.altitude ?? 0,
					label: 'My location'
				});
			},
			(error) => {
				geolocating = false;
				geoError =
					error.code === error.PERMISSION_DENIED
						? 'Location permission denied — your position is unchanged. Search for a place instead.'
						: 'Could not get your location — your position is unchanged.';
			},
			{ enableHighAccuracy: false, timeout: 10000 }
		);
	}

	function applyManual(event: Event) {
		event.preventDefault();
		const form = event.target as HTMLFormElement;
		const data = new FormData(form);
		const nextLat = Number(data.get('lat'));
		const nextLon = Number(data.get('lon'));
		if (!Number.isFinite(nextLat) || !Number.isFinite(nextLon)) return;
		if (Math.abs(nextLat) > 90 || Math.abs(nextLon) > 180) return;
		onchange({
			lat: nextLat,
			lon: nextLon,
			elevation: Number(data.get('elevation')) || 0,
			label: 'Custom position'
		});
	}
</script>

<div class="picker">
	<div class="current">
		<span class="stat-label">Watching from</span>
		<strong>{label}</strong>
	</div>

	<div class="row">
		<div class="search">
			<label class="visually-hidden" for="place-search">Search for a town or city</label>
			<input
				id="place-search"
				type="text"
				placeholder="Search any town or city…"
				bind:value={query}
				onfocus={() => (open = true)}
				onkeydown={onKeydown}
				autocomplete="off"
				role="combobox"
				aria-expanded={open && suggestions.length > 0}
				aria-controls="place-results"
			/>
			{#if open && query.trim().length >= 2}
				<ul class="results" id="place-results" role="listbox">
					{#each suggestions as suggestion, index (suggestion.key)}
						<li>
							<button
								type="button"
								class:highlighted={index === highlighted}
								onclick={() => choose(suggestion)}
								onmouseenter={() => (highlighted = index)}
							>
								<span class="result-text">
									<span class="result-name">
										{suggestion.name}
										{#if suggestion.curated}<i class="listed" title="On the recommended list">★</i>{/if}
									</span>
									<small>{suggestion.detail}</small>
								</span>
								<span class="verdict verdict-{suggestion.summary.kind}">
									{suggestion.summary.label}
								</span>
							</button>
						</li>
					{/each}

					{#if searching}
						<li class="status">Searching worldwide…</li>
					{:else if !suggestions.length}
						<li class="status">No places found for “{query.trim()}”.</li>
					{/if}
					{#if searchError}
						<li class="status status-error">{searchError}</li>
					{/if}
				</ul>
			{/if}
		</div>
		<button type="button" onclick={locate} disabled={geolocating}>
			{geolocating ? 'Locating…' : 'Use my location'}
		</button>
	</div>

	{#if geoError}
		<p class="error">{geoError}</p>
	{/if}

	<form class="manual" onsubmit={applyManual}>
		<label>
			<span>Latitude</span>
			<input type="number" name="lat" step="0.0001" min="-90" max="90" value={lat.toFixed(4)} />
		</label>
		<label>
			<span>Longitude</span>
			<input type="number" name="lon" step="0.0001" min="-180" max="180" value={lon.toFixed(4)} />
		</label>
		<label>
			<span>Height (m)</span>
			<input type="number" name="elevation" step="1" value={Math.round(elevation)} />
		</label>
		<button type="submit">Apply</button>
	</form>

	<p class="credit">Place search by Open-Meteo, using GeoNames data.</p>
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.current {
		display: flex;
		flex-direction: column;
	}

	.current strong {
		font-size: 1.1rem;
	}

	.row {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.search {
		position: relative;
		flex: 1;
	}

	.search input {
		width: 100%;
	}

	.results {
		position: absolute;
		z-index: 20;
		top: calc(100% + 3px);
		left: 0;
		right: 0;
		margin: 0;
		padding: 0.25rem;
		list-style: none;
		background: var(--bg-raised);
		border: 1px solid var(--border-strong);
		border-radius: 9px;
		max-height: 320px;
		overflow-y: auto;
		box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
	}

	.results li {
		margin: 0;
	}

	.results button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		padding: 0.4rem 0.5rem;
		border-radius: 6px;
	}

	.results button:hover,
	.results button.highlighted {
		background: var(--bg-card);
	}

	.result-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.result-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.listed {
		font-style: normal;
		color: var(--sun);
		font-size: 0.8em;
		cursor: help;
	}

	.results small {
		color: var(--text-faint);
		font-size: 0.78rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.verdict {
		flex: none;
		font-size: 0.72rem;
		font-weight: 600;
		padding: 0.12rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		color: var(--text-dim);
		white-space: nowrap;
	}

	.verdict-total {
		background: var(--total-soft);
		border-color: #4c3fa0;
		color: #c7bcff;
	}

	.verdict-partial,
	.verdict-sunset {
		background: #2b2416;
		border-color: #5a4a24;
		color: var(--sun-bright);
	}

	.verdict-none {
		color: var(--text-faint);
	}

	.status {
		padding: 0.4rem 0.5rem;
		font-size: 0.82rem;
		color: var(--text-faint);
	}

	.status-error {
		color: var(--sun);
	}

	.manual {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: flex-end;
	}

	.manual label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.78rem;
		color: var(--text-faint);
	}

	.manual input {
		width: 8.5rem;
	}

	.error {
		color: var(--danger);
		font-size: 0.85rem;
		margin: 0;
	}

	.credit {
		margin: 0;
		font-size: 0.74rem;
		color: var(--text-faint);
	}
</style>
