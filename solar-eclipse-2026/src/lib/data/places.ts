/**
 * Places worth listing, with their coordinates and August cloud climatology.
 *
 * Only the geography and the climate statistics are stored here. Every eclipse
 * number shown on the site — contact times, duration, Sun altitude, obscuration
 * — is computed from the Besselian elements at runtime, so the tables can never
 * drift out of step with the simulator.
 */

export interface Place {
	name: string;
	region: string;
	country: string;
	lat: number;
	lon: number;
	/** Metres above sea level. */
	elevation: number;
	/**
	 * Typical fraction of the sky covered by cloud on an August evening, from
	 * long-run climatology. This is a historical average and emphatically not a
	 * forecast for the day.
	 */
	augustCloud?: number;
	/** IANA time zone, for showing local times. */
	timeZone: string;
	note?: string;
}

export const PATH_PLACES: Place[] = [
	// --- Iceland -------------------------------------------------------------
	{
		name: 'Reykjavík',
		region: 'Capital Region',
		country: 'Iceland',
		lat: 64.1466,
		lon: -21.9426,
		elevation: 30,
		augustCloud: 0.72,
		timeZone: 'Atlantic/Reykjavik',
		note: 'On the southern edge of the path — totality is very short and ends abruptly a few km further south.'
	},
	{
		name: 'Grundarfjörður',
		region: 'Snæfellsnes',
		country: 'Iceland',
		lat: 64.9215,
		lon: -23.2624,
		elevation: 10,
		augustCloud: 0.7,
		timeZone: 'Atlantic/Reykjavik',
		note: 'Snæfellsnes peninsula sits close to the centre line with the Sun still well up.'
	},
	{
		name: 'Ísafjörður',
		region: 'Westfjords',
		country: 'Iceland',
		lat: 66.0748,
		lon: -23.135,
		elevation: 6,
		augustCloud: 0.71,
		timeZone: 'Atlantic/Reykjavik',
		note: 'Deep in the path, with the highest Sun of any easily reachable town.'
	},
	{
		name: 'Stykkishólmur',
		region: 'Snæfellsnes',
		country: 'Iceland',
		lat: 65.0748,
		lon: -22.7305,
		elevation: 12,
		augustCloud: 0.68,
		timeZone: 'Atlantic/Reykjavik'
	},

	// --- Spain: Atlantic and Cantabrian coast --------------------------------
	{
		name: 'A Coruña',
		region: 'Galicia',
		country: 'Spain',
		lat: 43.3623,
		lon: -8.4115,
		elevation: 20,
		augustCloud: 0.55,
		timeZone: 'Europe/Madrid',
		note: 'Highest Sun of any Spanish city in the path, but the most cloud-prone coast.'
	},
	{
		name: 'Oviedo',
		region: 'Asturias',
		country: 'Spain',
		lat: 43.3619,
		lon: -5.8494,
		elevation: 230,
		augustCloud: 0.56,
		timeZone: 'Europe/Madrid'
	},
	{
		name: 'Gijón',
		region: 'Asturias',
		country: 'Spain',
		lat: 43.5322,
		lon: -5.6611,
		elevation: 10,
		augustCloud: 0.58,
		timeZone: 'Europe/Madrid'
	},
	{
		name: 'Santander',
		region: 'Cantabria',
		country: 'Spain',
		lat: 43.4623,
		lon: -3.805,
		elevation: 15,
		augustCloud: 0.55,
		timeZone: 'Europe/Madrid'
	},
	{
		name: 'Bilbao',
		region: 'Basque Country',
		country: 'Spain',
		lat: 43.263,
		lon: -2.935,
		elevation: 19,
		augustCloud: 0.52,
		timeZone: 'Europe/Madrid',
		note: 'Very close to the northern limit: totality is brief and the northern suburbs may miss it.'
	},
	{
		name: 'Santiago de Compostela',
		region: 'Galicia',
		country: 'Spain',
		lat: 42.8782,
		lon: -8.5448,
		elevation: 260,
		augustCloud: 0.54,
		timeZone: 'Europe/Madrid'
	},

	// --- Spain: the meseta, the best odds ------------------------------------
	{
		name: 'León',
		region: 'Castile and León',
		country: 'Spain',
		lat: 42.5987,
		lon: -5.5671,
		elevation: 837,
		augustCloud: 0.3,
		timeZone: 'Europe/Madrid'
	},
	{
		name: 'Palencia',
		region: 'Castile and León',
		country: 'Spain',
		lat: 42.0096,
		lon: -4.5288,
		elevation: 740,
		augustCloud: 0.24,
		timeZone: 'Europe/Madrid',
		note: 'Close to the centre line with some of the clearest August skies on the route.'
	},
	{
		name: 'Burgos',
		region: 'Castile and León',
		country: 'Spain',
		lat: 42.3439,
		lon: -3.6969,
		elevation: 860,
		augustCloud: 0.28,
		timeZone: 'Europe/Madrid'
	},
	{
		name: 'Valladolid',
		region: 'Castile and León',
		country: 'Spain',
		lat: 41.6523,
		lon: -4.7245,
		elevation: 698,
		augustCloud: 0.24,
		timeZone: 'Europe/Madrid'
	},
	{
		name: 'Soria',
		region: 'Castile and León',
		country: 'Spain',
		lat: 41.7665,
		lon: -2.4791,
		elevation: 1065,
		augustCloud: 0.27,
		timeZone: 'Europe/Madrid'
	},
	{
		name: 'Logroño',
		region: 'La Rioja',
		country: 'Spain',
		lat: 42.4627,
		lon: -2.445,
		elevation: 384,
		augustCloud: 0.3,
		timeZone: 'Europe/Madrid'
	},

	// --- Spain: Ebro valley and the Mediterranean ----------------------------
	{
		name: 'Zaragoza',
		region: 'Aragon',
		country: 'Spain',
		lat: 41.6488,
		lon: -0.8891,
		elevation: 208,
		augustCloud: 0.2,
		timeZone: 'Europe/Madrid',
		note: 'The Ebro valley is in the rain shadow of the Cantabrian mountains and is reliably clear.'
	},
	{
		name: 'Teruel',
		region: 'Aragon',
		country: 'Spain',
		lat: 40.3456,
		lon: -1.1065,
		elevation: 915,
		augustCloud: 0.22,
		timeZone: 'Europe/Madrid'
	},
	{
		name: 'Castellón de la Plana',
		region: 'Valencian Community',
		country: 'Spain',
		lat: 39.9864,
		lon: -0.0513,
		elevation: 30,
		augustCloud: 0.2,
		timeZone: 'Europe/Madrid'
	},
	{
		name: 'Valencia',
		region: 'Valencian Community',
		country: 'Spain',
		lat: 39.4699,
		lon: -0.3763,
		elevation: 15,
		augustCloud: 0.21,
		timeZone: 'Europe/Madrid',
		note: 'The Sun is only a few degrees up: you need a clear view out over the sea or a low western horizon.'
	},

	// --- Balearic Islands ----------------------------------------------------
	{
		name: 'Palma de Mallorca',
		region: 'Balearic Islands',
		country: 'Spain',
		lat: 39.5696,
		lon: 2.6502,
		elevation: 13,
		augustCloud: 0.16,
		timeZone: 'Europe/Madrid',
		note: 'Longest totality of any Spanish city, but with the Sun barely above the horizon.'
	},
	{
		name: 'Ibiza',
		region: 'Balearic Islands',
		country: 'Spain',
		lat: 38.9089,
		lon: 1.4328,
		elevation: 10,
		augustCloud: 0.15,
		timeZone: 'Europe/Madrid'
	},
	{
		name: 'Maó (Menorca)',
		region: 'Balearic Islands',
		country: 'Spain',
		lat: 39.8885,
		lon: 4.2658,
		elevation: 45,
		augustCloud: 0.17,
		timeZone: 'Europe/Madrid'
	},

	// --- Portugal ------------------------------------------------------------
	{
		name: 'Viana do Castelo',
		region: 'Norte',
		country: 'Portugal',
		lat: 41.6946,
		lon: -8.8305,
		elevation: 15,
		augustCloud: 0.45,
		timeZone: 'Europe/Lisbon',
		note: 'The far north-west tip of Portugal catches the very edge of the path.'
	}
];

/** Cities that get a partial eclipse only — most of Europe. */
export const PARTIAL_PLACES: Place[] = [
	{ name: 'Madrid', region: 'Community of Madrid', country: 'Spain', lat: 40.4168, lon: -3.7038, elevation: 650, timeZone: 'Europe/Madrid', note: 'The southern limit clips the city: it misses totality by a few kilometres.' },
	{ name: 'Barcelona', region: 'Catalonia', country: 'Spain', lat: 41.3874, lon: 2.1686, elevation: 12, timeZone: 'Europe/Madrid', note: 'Just outside the southern limit — a hair short of totality.' },
	{ name: 'Lisbon', region: '', country: 'Portugal', lat: 38.7223, lon: -9.1393, elevation: 100, timeZone: 'Europe/Lisbon' },
	{ name: 'Porto', region: '', country: 'Portugal', lat: 41.1579, lon: -8.6291, elevation: 100, timeZone: 'Europe/Lisbon' },
	{ name: 'Paris', region: '', country: 'France', lat: 48.8566, lon: 2.3522, elevation: 35, timeZone: 'Europe/Paris' },
	{ name: 'Bordeaux', region: '', country: 'France', lat: 44.8378, lon: -0.5792, elevation: 20, timeZone: 'Europe/Paris' },
	{ name: 'Marseille', region: '', country: 'France', lat: 43.2965, lon: 5.3698, elevation: 12, timeZone: 'Europe/Paris' },
	{ name: 'London', region: '', country: 'United Kingdom', lat: 51.5072, lon: -0.1276, elevation: 11, timeZone: 'Europe/London' },
	{ name: 'Edinburgh', region: '', country: 'United Kingdom', lat: 55.9533, lon: -3.1883, elevation: 47, timeZone: 'Europe/London' },
	{ name: 'Dublin', region: '', country: 'Ireland', lat: 53.3498, lon: -6.2603, elevation: 20, timeZone: 'Europe/Dublin' },
	{ name: 'Amsterdam', region: '', country: 'Netherlands', lat: 52.3676, lon: 4.9041, elevation: 2, timeZone: 'Europe/Amsterdam' },
	{ name: 'Brussels', region: '', country: 'Belgium', lat: 50.8503, lon: 4.3517, elevation: 30, timeZone: 'Europe/Brussels' },
	{ name: 'Berlin', region: '', country: 'Germany', lat: 52.52, lon: 13.405, elevation: 34, timeZone: 'Europe/Berlin' },
	{ name: 'Munich', region: '', country: 'Germany', lat: 48.1351, lon: 11.582, elevation: 520, timeZone: 'Europe/Berlin' },
	{ name: 'Zurich', region: '', country: 'Switzerland', lat: 47.3769, lon: 8.5417, elevation: 408, timeZone: 'Europe/Zurich' },
	{ name: 'Milan', region: '', country: 'Italy', lat: 45.4642, lon: 9.19, elevation: 120, timeZone: 'Europe/Rome' },
	{ name: 'Rome', region: '', country: 'Italy', lat: 41.9028, lon: 12.4964, elevation: 21, timeZone: 'Europe/Rome' },
	{ name: 'Vienna', region: '', country: 'Austria', lat: 48.2082, lon: 16.3738, elevation: 190, timeZone: 'Europe/Vienna' },
	{ name: 'Prague', region: '', country: 'Czechia', lat: 50.0755, lon: 14.4378, elevation: 200, timeZone: 'Europe/Prague' },
	{ name: 'Copenhagen', region: '', country: 'Denmark', lat: 55.6761, lon: 12.5683, elevation: 14, timeZone: 'Europe/Copenhagen' },
	{ name: 'Oslo', region: '', country: 'Norway', lat: 59.9139, lon: 10.7522, elevation: 23, timeZone: 'Europe/Oslo' },
	{ name: 'Stockholm', region: '', country: 'Sweden', lat: 59.3293, lon: 18.0686, elevation: 28, timeZone: 'Europe/Stockholm' },
	{ name: 'Warsaw', region: '', country: 'Poland', lat: 52.2297, lon: 21.0122, elevation: 100, timeZone: 'Europe/Warsaw' },
	{ name: 'Bucharest', region: '', country: 'Romania', lat: 44.4268, lon: 26.1025, elevation: 70, timeZone: 'Europe/Bucharest' },
	{ name: 'Casablanca', region: '', country: 'Morocco', lat: 33.5731, lon: -7.5898, elevation: 50, timeZone: 'Africa/Casablanca' },
	{ name: 'Reykjanesbær', region: '', country: 'Iceland', lat: 64.0049, lon: -22.5657, elevation: 20, timeZone: 'Atlantic/Reykjavik' },
	{ name: 'Nuuk', region: '', country: 'Greenland', lat: 64.1836, lon: -51.7214, elevation: 30, timeZone: 'America/Nuuk' },
	{ name: 'New York', region: '', country: 'United States', lat: 40.7128, lon: -74.006, elevation: 10, timeZone: 'America/New_York' }
];

export const ALL_PLACES = [...PATH_PLACES, ...PARTIAL_PLACES];
