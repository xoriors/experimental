export type Dict = {
	appTitle: string;
	language: string;
	resetTitle: string;
	tabs: { route: string; fixed: string; waypoints: string };
	help: { link: string; linkTitle: string };
	map: {
		fullscreen: string;
		exitFullscreen: string;
		exitFullscreenEsc: string;
	};
	intro: {
		title: string;
		body: string;
		route: string;
		fixed: string;
		pickDuration: string;
		installHint: string;
		readHelp: string;
		gotIt: string;
	};
	modeToggle: {
		ariaLabel: string;
		landHint: string;
		seaHint: string;
	};
	chips: {
		pin: string;
		unpin: string;
		pinTitle: string;
		unpinTitle: string;
		remove: string;
		removeTitle: string;
	};
	helpPage: {
		docTitle: string;
		back: string;
		backBtn: string;
		title: string;
		lede: string;
		twoTabs: string;
		routeDesc: string;
		fixedDesc: string;
		score: string;
		scoreDesc: string;
		scoreSea: string;
		scoreLand: string;
		bigControls: string;
		ctrlEarliest: string;
		ctrlDuration: string;
		ctrlDayTabs: string;
		readingTable: string;
		tblTime: string;
		tblTemp: string;
		tblWind: string;
		tblRain: string;
		tblCloud: string;
		sunHeading: string;
		sunDesc: string;
		recommendations: string;
		recommendationsDesc: string;
		savedPlaces: string;
		savedPlacesDesc: string;
		sharingHeading: string;
		shareLink: string;
		shareReset: string;
		installHeading: string;
		installDesc: string;
		installIos: string;
		installAndroid: string;
		installDesktop: string;
		tips: string;
		tip1: string;
		tip2: string;
		tip3: string;
		tryRoute: string;
	};
	waypoints: {
		editHelp: string;
		committedHelp: string;
		cancel: string;
		done: string;
		doneTitle: string;
		doneDisabledTitle: string;
		change: string;
		editPoint: string;
		pointN: string;
		point: string;
		clearAll: string;
		countOne: string;
		countMany: string;
		noneYet: string;
		computingLong: string;
		trackLabel: string;
		legsOne: string;
		legsMany: string;
		ferryLegs: string;
		seaLegs: string;
		straightLegs: string;
		straightPreview: string;
		editAriaLabel: string;
		editHint: string;
		moveBack: string;
		moveForward: string;
		delete: string;
		forecastCaption: string;
	};
	route: {
		computing: string;
		computingLong: string;
		ferryPrefix: string;
		waysSuffix: string;
		waysTitle: string;
		seaPrefix: string;
		detourTitle: string;
		greatCircleSuffix: string;
		straight: string;
		straightHint: string;
		ferryLabel: string;
	};
	days: { today: string; tomorrow: string; d2: string };
	share: {
		reset: string;
		copy: string;
		share: string;
		linkCopied: string;
		resetDone: string;
		weatherForecast: string;
		forecastView: string;
		copyFailed: string;
		clearAll: string;
		copyTitle: string;
		shareTitle: string;
	};
	place: {
		searchPlaceholder: string;
		fromPlaceholder: string;
		toPlaceholder: string;
		useMyLocation: string;
		locating: string;
		pickAPlace: string;
		geolocationFailed: string;
		fromPrefix: string;
		toPrefix: string;
		tapToDropPin: string;
	};
	forecast: {
		loading: string;
		fetchFailed: string;
		errorPrefix: string;
		alerts: string;
		airQuality: string;
		aqi: {
			'1': string;
			'2': string;
			'3': string;
			'4': string;
			'5': string;
			unknown: string;
		};
		fixedCaption: string;
		routeCaption: string;
		noData: string;
		sunrise: string;
		sunset: string;
		sunriseInBlock: string;
		sunsetInBlock: string;
		night: string;
		sunriseShort: string;
		sunsetShort: string;
	};
	trip: {
		earliestStart: string;
		latestStart: string;
		now: string;
		nowTitle: string;
		duration: string;
		mode: string;
		modeAuto: string;
		modeSea: string;
		modeLand: string;
		hoursSuffix: string;
		legendTitle: string;
		legendRange: string;
		bestAcross3Days: string;
		secondBest: string;
		windowSuffix: string;
		avg: string;
		avgInline: string;
		bestPerDay: string;
		noWindow: string;
		notEnoughData: string;
		clickToHighlight: string;
		scoreCombinesSea: string;
		scoreCombinesLand: string;
		secondPrefix: string;
		overrideBadge: string;
		cond: { wind: string; waves: string; rain: string; vis: string };
		separator: string;
	};
	intervalBar: {
		forThisDay: string;
		earliest: string;
		latest: string;
		duration: string;
		mode: string;
		reset: string;
		resetTitle: string;
		customSuffix: string;
		inherits: string;
	};
	refScale: {
		summary: string;
		wind: string;
		gust: string;
		rain: string;
		waveHs: string;
		windGood: string;
		windOk: string;
		windUnsafe: string;
		gustGood: string;
		gustOk: string;
		gustUnsafe: string;
		rainGood: string;
		rainOk: string;
		rainPoor: string;
		rainUnsafe: string;
		waveGood: string;
		waveOk: string;
		wavePoor: string;
		waveUnsafe: string;
	};
	table: {
		time: string;
		temp: string;
		windGust: string;
		rainPp: string;
		cloud: string;
		vis: string;
		wave: string;
		close: string;
		rowScoreTitle: string;
		tips: {
			time: string;
			temp: string;
			wind: string;
			rain: string;
			cloud: string;
			vis: string;
			wave: string;
		};
		tipLabels: {
			time: string;
			temp: string;
			wind: string;
			rain: string;
			cloud: string;
			vis: string;
			wave: string;
		};
	};
	hour: {
		outside: string;
		covered: string;
		valid: string;
	};
	marine: {
		seaLabel: string;
		hsLabel: string;
		period: string;
		swell: string;
	};
	seaState: {
		calm: string;
		smooth: string;
		slight: string;
		moderate: string;
		rough: string;
		veryRough: string;
		high: string;
		veryHigh: string;
	};
	activities: {
		swimming: string;
		sunbathing: string;
		hiking: string;
		kayaking: string;
		ferryOrBoat: string;
		photography: string;
		sightseeing: string;
	};
	summary: {
		goodFor: string;
		avoid: string;
		mixed: string;
	};
	wind: {
		head: string;
		headCross: string;
		cross: string;
		tailCross: string;
		tail: string;
		relativeTooltip: string;
	};
	windMap: {
		regionLabel: string;
		now: string;
		nowTitle: string;
		jumpNowTitle: string;
		prevHour: string;
		nextHour: string;
		verdict: {
			head: string;
			headCross: string;
			cross: string;
			tailCross: string;
			tail: string;
		};
	};
};

export const en: Dict = {
	appTitle: '🌦️ Weather Voodoo',
	language: 'Language',
	resetTitle: 'Reset all selections and go home',
	tabs: {
		route: 'Route',
		fixed: 'Fixed location',
		waypoints: 'Waypoints'
	},
	help: {
		link: '? Help',
		linkTitle: 'What this app does and how to use it'
	},
	map: {
		fullscreen: 'Full screen map',
		exitFullscreen: 'Exit full screen',
		exitFullscreenEsc: 'Exit full screen (Esc)'
	},
	intro: {
		title: '🌦️ Welcome to Weather Voodoo',
		body: 'Find the best hours of the next 3 days for an outdoor or marine trip. Wind, gust, rain, wave and visibility are blended into a 0–100 score and the best contiguous windows are surfaced for you.',
		route: '<strong>Route</strong>: forecast fused along a path (ferry / kayak / drive).',
		fixed: '<strong>Fixed location</strong>: one spot (beach, hike, sunset).',
		pickDuration: 'Pick a duration, a time window, and Sea / Land mode — the table colours each hour by score.',
		installHint: '📲 Install to your home screen (iOS Share → <em>Add to Home Screen</em>; Android menu → <em>Install app</em>) — it works offline once the shell is cached.',
		readHelp: 'Read the full help',
		gotIt: 'Got it'
	},
	modeToggle: {
		ariaLabel: 'Trip mode',
		landHint: 'hike · sightsee · drive · photo',
		seaHint: 'ferry · kayak · boat · swim'
	},
	chips: {
		pin: 'Pin',
		unpin: 'Unpin',
		pinTitle: 'Pin so it stays in the list',
		unpinTitle: 'Unpin',
		remove: 'Remove',
		removeTitle: 'Remove from recents'
	},
	helpPage: {
		docTitle: 'Help · Weather Voodoo',
		back: '← Back to the app',
		backBtn: 'Back to the app',
		title: 'How Weather Voodoo works',
		lede: 'It picks the best hours of the next 3 days for a specific outdoor or marine trip — by blending wind, gust, rain, wave height and visibility into a single 0–100 score, then surfacing the best contiguous windows that fit your time and duration.',
		twoTabs: 'The tabs',
		routeDesc: '<strong>Route</strong> — pick a <em>From</em> and <em>To</em>. The forecast is fused across 3 sample points along the line, taking the <em>worst-case</em> conditions hour-by-hour. Good for ferry/boat trips, drives, kayak crossings.',
		fixedDesc: '<strong>Fixed location</strong> — one place. Good for a beach day, hike, sunset session.',
		score: 'The score',
		scoreDesc: "Each hour is scored 0–100 based on the activity type. The window score is the <em>worst hour</em> in the range (chain-as-strong-as-weakest-link); average score is the tiebreaker.",
		scoreSea: '<strong>Sea mode</strong> — ferry/boat + kayaking verdicts dominate (wave, gust, visibility).',
		scoreLand: '<strong>Land mode</strong> — sightseeing + hiking + photography verdicts (rain, wind, temp, visibility).',
		bigControls: 'The big controls',
		ctrlEarliest: '<strong>Earliest / Latest start</strong> — restrict candidate start times of day. Defaults to 00:00–23:00 in 30-min steps.',
		ctrlDuration: "<strong>Duration</strong> — how long you'll be out (1, 2, 3, 4, 6, 8, 12 h).",
		ctrlDayTabs: '<strong>Day tabs</strong> — Today / Tomorrow / Day after. Each tab can override the global earliest/latest/duration/mode just for that day.',
		readingTable: 'Reading the table',
		tblTime: '<strong>Time</strong> — 3-hour blocks (00–03, 03–06, …) with a small score chip. Click a block to expand into 1-hour rows.',
		tblTemp: '<strong>Temp</strong> — weather-condition icon + temperature in °C.',
		tblWind: '<strong>Wind / gust</strong> — sustained / peak in knots, with cardinal direction the wind is coming from.',
		tblRain: '<strong>Rain / Pₚ</strong> — mm/h + probability of precipitation.',
		tblCloud: '<strong>Cloud / Vis / Wave</strong> — cloud %, visibility km, significant wave height (Hₛ) m.',
		sunHeading: 'Sunrise & sunset',
		sunDesc: 'The "☀️ Sunrise · 🌙 Sunset" line above each day\'s table shows the day\'s times. Night-time rows are tinted darker; hours that straddle a transition get a 🌅 / 🌇 marker in the time cell.',
		recommendations: 'Recommendations',
		recommendationsDesc: 'Above the score-coloured "Best across 3 days" card, the <strong>1st & 2nd best windows</strong> are highlighted per day. Click one to jump-highlight it in the table below.',
		savedPlaces: 'Saved places',
		savedPlacesDesc: "Picking a place via search or \"📍 Use my location\" saves it in a chip row under the inputs. ★ pins so it never gets evicted; × removes a recent (pinned ones can't be removed by accident).",
		sharingHeading: 'Sharing & resetting',
		shareLink: "The whole state lives in the URL hash — <strong>📋 Copy link</strong> or <strong>🔗 Share</strong> copies the exact view you're on.",
		shareReset: '<strong>↻ Reset</strong> (or clicking the 🌦️ logo) clears the current selection but <em>keeps</em> your saved places.',
		installHeading: 'Install on your phone',
		installDesc: "Weather Voodoo is a PWA: you can install it to your home screen and launch it like a native app. It also caches its shell so a flaky cell signal won't kill the page.",
		installIos: '<strong>iOS Safari</strong> — tap the Share button → <em>Add to Home Screen</em>.',
		installAndroid: '<strong>Android Chrome</strong> — three-dot menu → <em>Install app</em> (or wait for the install banner).',
		installDesktop: '<strong>Desktop Chrome / Edge</strong> — click the install icon in the address bar (or three-dot menu → <em>Install Weather Voodoo</em>).',
		tips: 'Tips',
		tip1: '"Today" never proposes a window that already started — past hours still appear in the table with their scores, they\'re just not in the suggestions.',
		tip2: 'All times are in your local timezone.',
		tip3: "The reference scale at the top of each day's table shows the good / caution / unsafe bands for each metric.",
		tryRoute: 'Try a sample route'
	},
	waypoints: {
		editHelp: '<strong>Tap the map</strong> to add a waypoint. To edit one, <strong>tap its red marker</strong> on the map or <strong>tap its chip in the list below</strong> — reorder, delete and move-to options open in a dialog. You can also drag a red marker directly (long-press on mobile). Straight-line preview shown while editing — press <strong>✓ Done</strong> to compute the real route and forecast.',
		committedHelp: '<strong>Track committed.</strong> Press <strong>✎ Change waypoints</strong> to edit.',
		cancel: 'Cancel',
		done: '✓ Done',
		doneTitle: 'Compute route & forecasts',
		doneDisabledTitle: 'Add at least 2 waypoints',
		change: '✎ Change waypoints',
		editPoint: 'Edit point {n}',
		pointN: 'Point {n}',
		point: 'Point',
		clearAll: '↻ Clear all',
		countOne: '{n} point',
		countMany: '{n} points',
		noneYet: 'No waypoints yet — tap the map below to start.',
		computingLong: 'Computing route & fetching forecasts… first request in a region can take up to 15 s.',
		trackLabel: 'Track',
		legsOne: '{n} leg',
		legsMany: '{n} legs',
		ferryLegs: '{n} ferry',
		seaLegs: '{n} open-ocean',
		straightLegs: '{n} straight',
		straightPreview: '📐 Straight-line preview while editing — press Done to compute the real route.',
		editAriaLabel: 'Edit waypoint',
		editHint: '👉 Tap anywhere on the map to <strong>move this point</strong> there, or drag the red marker. Use the actions below to reorder or delete.',
		moveBack: '← Move back',
		moveForward: 'Move forward →',
		delete: '× Delete',
		forecastCaption: 'Forecast fused across 3 sample points along the track. Worst-case wind/wave/rain shown per hour. Times in {timezone}.'
	},
	route: {
		computing: 'Computing route…',
		computingLong: 'Computing best sea route & fetching forecasts… first request in a region can take up to 15 s.',
		ferryPrefix: '⛴️ Ferry route via OpenStreetMap:',
		waysSuffix: '({n} ways in the area)',
		waysTitle: 'number of distinct ferry ways considered',
		seaPrefix: '⚓ Open-ocean route:',
		detourTitle: 'route length / great-circle length',
		greatCircleSuffix: 'the great-circle line',
		straight: "📐 Straight-line route — couldn't snap to a sea-route network.",
		straightHint: 'Sample points may cross land.',
		ferryLabel: 'ferry'
	},
	days: {
		today: 'Today',
		tomorrow: 'Tomorrow',
		d2: 'Day after'
	},
	share: {
		reset: '↻ Reset',
		copy: '📋 Copy link',
		share: '🔗 Share',
		linkCopied: 'Link copied',
		resetDone: 'Reset',
		weatherForecast: 'Weather forecast',
		forecastView: 'Forecast view',
		copyFailed: 'Copy failed — long-press the URL bar',
		clearAll: 'Clear all selections',
		copyTitle: 'Copy link to clipboard',
		shareTitle: 'Share via OS'
	},
	place: {
		searchPlaceholder: 'Search a place…',
		fromPlaceholder: 'From — search or click on map',
		toPlaceholder: 'To — search or click on map',
		useMyLocation: '📍 Use my location',
		locating: 'Locating…',
		pickAPlace: 'Pick a place or click on the map.',
		geolocationFailed: 'Geolocation failed',
		fromPrefix: 'From',
		toPrefix: 'To',
		tapToDropPin: 'Tap the map to drop a pin — first tap is From, second is To.'
	},
	forecast: {
		loading: 'Loading forecast…',
		fetchFailed: 'Fetch failed',
		errorPrefix: 'Error',
		alerts: 'Alerts:',
		airQuality: 'Air quality (OpenWeather)',
		aqi: {
			'1': 'Good',
			'2': 'Fair',
			'3': 'Moderate',
			'4': 'Poor',
			'5': 'Very poor',
			unknown: 'unknown'
		},
		fixedCaption: 'Forecast in {timezone}. 3h blocks aggregate worst conditions in the period. Click a row to expand hourly.',
		routeCaption: 'Fused route forecast across 3 sample points. Worst-case wind/wave/rain shown per hour. Times in {timezone}.',
		noData: 'No forecast data for this day.',
		sunrise: '☀️ Sunrise',
		sunset: '🌙 Sunset',
		sunriseInBlock: 'Sunrise in this block',
		sunsetInBlock: 'Sunset in this block',
		night: 'Night',
		sunriseShort: 'Sunrise',
		sunsetShort: 'Sunset'
	},
	trip: {
		earliestStart: 'Earliest start',
		latestStart: 'Latest start',
		now: 'Now',
		nowTitle: 'Set to nearest half-hour to now',
		duration: 'Duration',
		mode: 'Mode',
		modeAuto: 'Auto ({resolved})',
		modeSea: 'Sea',
		modeLand: 'Land',
		hoursSuffix: '{n} h',
		legendTitle: 'Score 0 (worst) → 100 (best)',
		legendRange: '0 → 100',
		bestAcross3Days: '★ Best across 3 days:',
		secondBest: '2nd best:',
		windowSuffix: '{n}h window:',
		avg: 'avg {n}',
		avgInline: '(avg {n})',
		bestPerDay: 'Best windows each day:',
		noWindow: 'no window fits',
		notEnoughData: 'Not enough forecast data to find a window.',
		clickToHighlight: 'Click to highlight in the table below',
		scoreCombinesSea: 'Score combines ferry/boat + kayaking activity verdicts across each hour of the trip. Window score = worst-hour score (chain-as-strong-as-weakest-link). Times in {timezone}.',
		scoreCombinesLand: 'Score combines sightseeing + hiking + photography activity verdicts across each hour of the trip. Window score = worst-hour score (chain-as-strong-as-weakest-link). Times in {timezone}.',
		secondPrefix: '2nd',
		overrideBadge: '{n}h · {mode}',
		cond: {
			wind: 'wind {x}/{y} kn',
			waves: 'waves {x} m',
			rain: 'rain {x} mm/h',
			vis: 'vis {x} km'
		},
		separator: ' · '
	},
	intervalBar: {
		forThisDay: 'For this day:',
		earliest: 'earliest',
		latest: 'latest',
		duration: 'duration',
		mode: 'mode',
		reset: '↻ reset',
		resetTitle: 'Reset to top defaults',
		customSuffix: '(custom — top default: {min}–{max}, {dur}h, {mode})',
		inherits: '(inherits top defaults)'
	},
	refScale: {
		summary: 'Reference scale — what counts as good vs bad',
		wind: 'Wind',
		gust: 'Gust',
		rain: 'Rain',
		waveHs: 'Wave Hₛ',
		windGood: '< 12 kn calm/light',
		windOk: '12–22 kn breezy',
		windUnsafe: '> 22 kn small-craft',
		gustGood: '< 18 kn',
		gustOk: '18–28 kn',
		gustUnsafe: '> 28 kn unsafe boats',
		rainGood: '< 0.5 mm/h dry',
		rainOk: '0.5–2 light',
		rainPoor: '2–5 moderate',
		rainUnsafe: '> 5 heavy',
		waveGood: '< 0.5 m calm',
		waveOk: '0.5–1 slight',
		wavePoor: '1–2 moderate',
		waveUnsafe: '> 2 rough'
	},
	table: {
		time: 'Time',
		temp: 'Temp',
		windGust: 'Wind / gust',
		rainPp: 'Rain / Pₚ',
		cloud: 'Cloud',
		vis: 'Vis',
		wave: 'Wave',
		close: 'Close',
		rowScoreTitle: 'Best start within this block (window score 0–100)',
		tips: {
			time: "Hour (HH:00) or aggregated range (HH–HH) in the destination's local timezone. Click a single-hour row to expand 3-hour summaries.",
			temp: 'Air temperature at 2 m height, in degrees Celsius. The icon to the left summarises conditions: ☀ clear, 🌤 partly cloudy, ☁ overcast, 🌦 light rain, 🌧 rain, ⛈ thunderstorm.',
			wind: 'Sustained wind speed / peak gust, in knots (kn), followed by the cardinal direction the wind is coming FROM (e.g. W = westerly). Good < 12 kn, breezy 12–22, small-craft warning > 22.',
			rain: 'Total precipitation in millimetres per hour. Pₚ = probability of precipitation (0–100%). Dry < 0.5 mm/h, light 0.5–2, moderate 2–5, heavy > 5.',
			cloud: 'Cloud cover, 0% = clear sky, 100% = fully overcast.',
			vis: 'Horizontal visibility, in kilometres. Lower values (< 2 km) indicate fog, haze, or heavy rain.',
			wave: 'Significant wave height (Hₛ) in metres — the average of the highest one-third of waves. Calm < 0.5 m, slight 0.5–1, moderate 1–2, rough > 2. Marine forecast only; missing for inland points.'
		},
		tipLabels: {
			time: 'Time',
			temp: 'Temp',
			wind: 'Wind / gust',
			rain: 'Rain / Pₚ',
			cloud: 'Cloud',
			vis: 'Visibility',
			wave: 'Wave Hₛ'
		}
	},
	hour: {
		outside: '{score} — outside your trip window; adjust Earliest/Latest to include this hour',
		covered: "{score} — during your trip but not a valid start time (score is for this hour's conditions)",
		valid: 'Score 0–100 for a trip starting at this hour'
	},
	marine: {
		seaLabel: 'Sea',
		hsLabel: 'H_s',
		period: 'period',
		swell: 'swell'
	},
	seaState: {
		calm: 'Calm',
		smooth: 'Smooth',
		slight: 'Slight',
		moderate: 'Moderate',
		rough: 'Rough',
		veryRough: 'Very rough',
		high: 'High',
		veryHigh: 'Very high'
	},
	activities: {
		swimming: 'swimming',
		sunbathing: 'sunbathing',
		hiking: 'hiking',
		kayaking: 'kayaking',
		ferryOrBoat: 'ferry/boat trips',
		photography: 'photography',
		sightseeing: 'sightseeing'
	},
	summary: {
		goodFor: 'Good for {items}.',
		avoid: 'Avoid {items}.',
		mixed: 'Mixed conditions.'
	},
	wind: {
		head: 'Head',
		headCross: 'Head-Cross',
		cross: 'Cross',
		tailCross: 'Tail-Cross',
		tail: 'Tail',
		relativeTooltip: '{cls} wind ({deg}° relative to direction of travel)'
	},
	windMap: {
		regionLabel: 'Wind along route — use arrow keys to scrub through hours',
		now: 'NOW',
		nowTitle: 'Showing wind for the current hour',
		jumpNowTitle: 'Jump back to the current hour',
		prevHour: 'Previous hour',
		nextHour: 'Next hour',
		verdict: {
			head: 'Head wind along the route — tough going',
			headCross: 'Head-cross wind — fighting it',
			cross: 'Cross wind — watch your balance',
			tailCross: 'Tail-cross wind — pushing you along',
			tail: 'Tail wind — free speed'
		}
	}
};
