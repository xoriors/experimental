<script lang="ts">
	import { ALL_PLACES, type Place } from '$lib/data/places';

	interface Props {
		lat: number;
		lon: number;
		elevation: number;
		label: string;
		onchange: (place: { lat: number; lon: number; elevation: number; label: string }) => void;
	}

	let { lat, lon, elevation, label, onchange }: Props = $props();

	let query = $state('');
	let geolocating = $state(false);
	let geoError = $state('');

	const matches = $derived(
		query.trim().length < 2
			? []
			: ALL_PLACES.filter((place) =>
					`${place.name} ${place.region} ${place.country}`
						.toLowerCase()
						.includes(query.trim().toLowerCase())
				).slice(0, 8)
	);

	function choose(place: Place) {
		query = '';
		onchange({
			lat: place.lat,
			lon: place.lon,
			elevation: place.elevation,
			label: `${place.name}, ${place.country}`
		});
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
						? 'Location permission denied — search for a place instead.'
						: 'Could not get your location.';
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
			<label class="visually-hidden" for="place-search">Search for a place</label>
			<input
				id="place-search"
				type="text"
				placeholder="Search a city…"
				bind:value={query}
				autocomplete="off"
			/>
			{#if matches.length}
				<ul class="results">
					{#each matches as place (place.name + place.country)}
						<li>
							<button type="button" onclick={() => choose(place)}>
								<span>{place.name}</span>
								<small>{place.region ? place.region + ', ' : ''}{place.country}</small>
							</button>
						</li>
					{/each}
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
		max-height: 260px;
		overflow-y: auto;
	}

	.results li {
		margin: 0;
	}

	.results button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		padding: 0.35rem 0.5rem;
		border-radius: 6px;
		gap: 0;
	}

	.results button:hover {
		background: var(--bg-card);
	}

	.results small {
		color: var(--text-faint);
		font-size: 0.78rem;
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
</style>
