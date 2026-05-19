# Weather Prediction

A SvelteKit webapp that gives hour-by-hour weather forecasts for a **route** (e.g. a ferry crossing) or a **fixed location**, with shareable URLs and per-period activity recommendations (swim/hike/kayak/boat/photo/sightsee).

Data sources:
- **[Open-Meteo](https://open-meteo.com)** — keyless. Hourly atmospheric + marine forecasts (`/v1/forecast`, `/v1/marine`) and place search (`geocoding-api.open-meteo.com/v1/search`).
- **[OpenWeather](https://openweathermap.org/api)** *(optional)* — UV index, air quality, and weather alerts. Server-side only; key never reaches the browser.

Maps:
- **MapLibre GL JS + OpenStreetMap** — always loaded, free, no key.
- **Google Maps + Places autocomplete** *(optional)* — used when `PUBLIC_GOOGLE_MAPS_API_KEY` is set; falls back to MapLibre + Open-Meteo geocoding otherwise.

## Quickstart (local)

```bash
cd weather-prediction
pnpm install
cp .env.example .env.local      # optional — app works without keys
pnpm dev                         # http://localhost:5173
```

Without any keys: MapLibre+OSM map renders, place search uses Open-Meteo geocoding, OpenWeather panels are hidden. Everything else (route fusion, 3h granularity with inline expand, share links, activity hints) works out of the box.

## Environment variables

Create `.env.local` (already in `.gitignore`):

```bash
# Required for OpenWeather UV / AQI / alerts. Server-side only.
OPENWEATHER_API_KEY=

# Optional. If empty, MapLibre + Open-Meteo geocoding take over.
# Public — restrict by HTTP referrer in Google Cloud Console.
PUBLIC_GOOGLE_MAPS_API_KEY=
```

### Provisioning the keys

**OpenWeather** — sign up at <https://openweathermap.org>, generate a key. Note that **One Call API 3.0** requires a paid subscription on new accounts (1,000 calls/day free with the subscription). If you don't subscribe, `/api/owm` will return `{available:false, reason:…}` and the UI gracefully hides the UV / alerts panels.

**Google Maps** — create a project in the [Google Cloud Console](https://console.cloud.google.com/), enable **Maps JavaScript API** + **Places API**, create an API key, then **restrict it by HTTP referrer** to:
- `http://localhost:5173/*`
- `https://*.vercel.app/*`
- `https://<your-prod-domain>/*`

Also set a daily quota cap in the Cloud Console (Maps gives ~$200/mo free credit; capping prevents surprises).

## Deploy to Vercel

```bash
pnpm install -g vercel             # if not already
cd weather-prediction
vercel link                        # one-time, links to a Vercel project
vercel env add OPENWEATHER_API_KEY     # paste the key (encrypted)
vercel env add PUBLIC_GOOGLE_MAPS_API_KEY   # optional
vercel deploy                      # preview URL
vercel deploy --prod               # production
```

After the preview deploys, add the preview URL to your Google Cloud key's referrer allowlist (otherwise the Maps script will be blocked).

`vercel.json` attaches `Cache-Control: public, s-maxage=600, stale-while-revalidate=3600` to all `/api/*` responses, so Vercel's edge cache absorbs repeated calls.

## Architecture

```
src/
├── lib/
│   ├── types.ts                # LatLng, ForecastHour, MarineHour, FusedHour, Activity, Verdict
│   ├── state.svelte.ts         # global Svelte 5 runes view state
│   ├── url-state.ts            # ?tab=&from=&to=&at=&day=&expand= encode/decode
│   ├── time.ts units.ts geo.ts # helpers
│   ├── fusion.ts               # per-hour max/min reducers, 3h aggregator
│   ├── activities.ts           # rule table + scoreHour() + summariseHour()
│   ├── server/                 # Open-Meteo + OpenWeather + LRU cache
│   ├── client/                 # Google Maps loader, Geolocation wrapper
│   └── components/             # Map, search, forecast table, share bar, …
└── routes/
    ├── +layout.svelte +layout.ts +page.svelte
    └── api/
        ├── forecast/+server.ts   # GET ?lat&lon&days
        ├── marine/+server.ts
        ├── route/+server.ts      # GET ?from&to&samples&days  → fused
        ├── owm/+server.ts        # GET ?lat&lon&kind=onecall|air
        └── geocode/+server.ts    # GET ?q
```

## Share links

State lives entirely in the URL — no backend storage needed.

```
/?tab=route&from=7.7388,98.7784&to=8.0340,98.8250&day=tomorrow&expand=09,15
/?tab=fixed&at=7.7388,98.7784&day=today&expand=12
```

The Share bar in the header copies the current URL (Clipboard API), or invokes `navigator.share()` on platforms that support it.

## 3h granularity + inline expand

Default view shows 8 rows per day at 00, 03, 06, 09, 12, 15, 18, 21. Each row aggregates the 3 hours in its block as **worst-case** (max wind/wave/rain, min visibility, average temp). Clicking the row expands inline to show the 3 individual hourly rows. State of which rows are expanded is also in the URL (`expand=09,15`) so a friend opening your share link sees the same expanded state.

## Activity rules

Defined in `src/lib/activities.ts`. Each activity has a declarative rule list; worst verdict wins per hour; verdicts: `good | ok | poor | unsafe`. Thresholds documented inline.

| Activity | Key thresholds |
|---|---|
| swimming | tempC ≥ 23 + windKn < 12 + dry → good. waveHs > 0.8 or tempC < 16 → unsafe. |
| sunbathing | cloud < 40% + dry + tempC ≥ 22 → good. UV ≥ 9 → poor. |
| hiking | rain < 0.5 mm/h + wind < 18 kn + vis > 5 km + temperate → good. |
| kayaking | waveHs < 0.5 + wind < 12 kn → good. waveHs > 1 or gust > 22 → unsafe. |
| ferry/boat | waveHs < 1 + gust < 22 + vis > 3 → good. waveHs > 2.5 or gust > 35 → unsafe. |
| photography | vis > 10 km + cloud in [20, 70] → good. |
| sightseeing | rain < 0.5 + wind < 18 → good. |

## Caching strategy

- **Server LRU**, keyed by `endpoint + lat/lon rounded to 3dp + day window`, TTL 10 min, max 500 entries.
- **HTTP headers**: `Cache-Control: public, s-maxage=600, stale-while-revalidate=3600` on every `/api/*` response → Vercel's edge cache absorbs repeated traffic.
- **Open-Meteo fair-use** (≈10k calls/day per IP) is well within reach thanks to the above two layers.

## Risks & known limitations

| Topic | Note |
|---|---|
| Google Maps billing | Restrict key by HTTP referrer + set a daily quota cap in Cloud Console. MapLibre fallback wired so traffic can be steered off Maps quickly. |
| OpenWeather One Call 3.0 | Requires paid sub on new accounts. App degrades gracefully if 401/403. |
| Open-Meteo accuracy | Hourly data is solid through day +2; we hard-cap the UI there. Marine accuracy drops sharply past day +3. |
| Geolocation | Needs HTTPS. Works on Vercel and localhost; fails on LAN IPs without HTTPS. |
| Timezones | Times always shown in the *location's* local TZ (Open-Meteo `timezone` field). `expand=09` is interpreted in that TZ, so share links stay meaningful across senders. |

## Scripts

```bash
pnpm dev          # local dev server
pnpm build        # production build
pnpm preview      # preview build locally
pnpm check        # type-check Svelte + TS
pnpm test         # vitest (fusion, activities, url-state, geo)
```

## Testing the share-link round trip

1. Open the app, drop a pin, expand a 3h row.
2. Click Share → Copy link.
3. Paste in an incognito window — identical view restored. This is the canonical end-to-end test.
