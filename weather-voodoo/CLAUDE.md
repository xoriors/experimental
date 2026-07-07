# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Weather Voodoo is a SvelteKit PWA showing hour-by-hour fused weather forecasts for a **route** (from → to), a **multi-leg waypoints trip**, or a **fixed location**, and ranks the best trip start windows with a 0–100 score. Live at [weather-voodoo.vercel.app](https://weather-voodoo.vercel.app). Fully functional with zero API keys (MapLibre + OpenStreetMap + Open-Meteo); optional keys add OpenWeather UV/AQI/alerts and Google Places autocomplete.

Stack: SvelteKit 2, Svelte 5 (runes), TypeScript, MapLibre GL, Vitest, Playwright, Vercel adapter (`nodejs20.x`).

## Commands

```bash
pnpm dev                              # dev server at http://localhost:5173
pnpm build                            # production build
pnpm check                            # type-check (svelte-kit sync + svelte-check)
pnpm test                             # all unit tests (vitest run, tests/)
pnpm test tests/trip-score.test.ts    # single test file
pnpm vitest run -t "name"             # single test by name
pnpm test:watch                       # vitest watch mode
pnpm test:e2e                         # Playwright (e2e/) — builds, then serves preview on :4173
```

**Deploy pitfall:** run `vercel deploy --prod --yes` **from inside `weather-voodoo/`**. Running it from the repo root deploys a *different* Vercel project — `.vercel/project.json` in this directory links the correct one.

Env vars go in `.env.local` (see `.env.example`): `OPENWEATHER_API_KEY` (server-only, read via `src/lib/server/env.ts`) and `PUBLIC_GOOGLE_MAPS_API_KEY` (optional; MapLibre + Open-Meteo geocoding take over when unset). OpenWeather failures degrade gracefully — the endpoint returns `{available: false, reason}` and the client hides those panels.

## Architecture

### URL fragment ⇄ global view state

All user input lives in one Svelte 5 `$state` object: `view` in `src/lib/state.svelte.ts` (shape: `ViewState` in `src/lib/types.ts`) — tab (`route | fixed | waypoints`), from/to/at/waypoints, day (`today | tomorrow | d2`), expanded 3h slots, trip-window settings (earliest/latest/duration/mode), per-day overrides (`intervals`), highlight, locale. `effectiveConfig(day)` merges a day's overrides over the top-level trip settings — use it instead of reading `view.trip*` directly whenever a day context exists.

The URL is the shareable source of truth: `src/lib/url-state.ts` encodes `ViewState` as readable `key=value` pairs in the URL **fragment** (`#t=route&f=7.73,98.77&…`), and `+layout.svelte` / `+layout.ts` keep URL ⇄ `view` in sync. Decoding also accepts legacy `?s=<base64-json>` and `?tab=…` links — never break old share links. **Any new piece of view state needs all three:** a `ViewState` field, encode + decode in `url-state.ts` (with a default so it's omitted when unset), and a round-trip case in `tests/url-state.test.ts`.

### Server data path

`src/routes/api/*` are thin GET endpoints over `src/lib/server/`:

- `forecast`, `marine`, `geocode`, `reverse-geocode` — Open-Meteo proxies (`server/openmeteo.ts`, keyless).
- `owm` — OpenWeather One Call 3.0 + air pollution (`server/openweather.ts`), server-side key only.
- `route` — samples 3 points along the from→to line, fetches forecast+marine per point, fuses server-side.
- `multi-route` — resolves each waypoint leg to the best available geometry: OSM ferry lines (`server/osm-ferry.ts`, Overpass + geojson-path-finder), maritime network (`server/sea-routing.ts`, searoute-ts), land trails (`server/osm-land.ts`), or straight-line fallback — then samples and fuses along the resolved polylines.

Three cache layers keep external APIs within fair-use: an in-memory LRU (`server/cache.ts`, keys round lat/lon to 3dp, 10-min TTL), `vercel.json` edge headers (`s-maxage=600, stale-while-revalidate=3600` on all `/api/*`), and the service worker (`src/service-worker.ts`) which precaches the app shell and serves API responses up to 6h stale for offline use.

### Domain logic — pure, dependency-free, unit-tested

The scoring pipeline lives in plain `.ts` modules under `src/lib/`, each mirrored by a `tests/<name>.test.ts`. Put new domain logic here (returning data/keys, not rendered strings) and let components consume it:

- `fusion.ts` — worst-case-along-route per-hour reducers (max wind/wave/rain, min visibility) → `FusedHour`; `aggregate` into 3h blocks.
- `activities.ts` — declarative threshold rules per activity → verdict `good | ok | poor | unsafe`.
- `trip-score.ts` — `hourTripScore` (sea = ferryOrBoat + kayaking; land = sightseeing + hiking + photography), `windowScoreAt` = **min** hour score across the trip duration (weakest link), `findBestWindows`, `detectMode` (sea vs land from marine-data availability), `scoreToCss` (red→green gradient).
- `wind.ts` / `wind-map.ts` — wind direction relative to travel heading → classification + map chevron overlay data.
- `time.ts`, `units.ts`, `geo.ts`, `daylight.ts` — TZ handling, unit conversion, haversine/route sampling, sunrise/sunset.

All times are in the **location's** local timezone (Open-Meteo `timezone` field); slot keys and highlight ISO strings are interpreted in that TZ so share links mean the same thing everywhere. The UI hard-caps at 3 days (today/tomorrow/d2) — forecast accuracy drops beyond that.

## Localization (i18n) — required for any user-facing text

- Source-of-truth dictionary: `src/lib/i18n/en.ts` — its exported `Dict` type defines the shape every locale must implement. Locales: `en`, `th`, `ro` (`src/lib/i18n/{en,th,ro}.ts`).
- Reactive locale state + `t(key, vars?)` helper: `src/lib/i18n/index.svelte.ts`. Interpolation uses `{name}` placeholders. Locale is part of URL state (`lng=`) and persisted in localStorage (`wx-voodoo-locale`).

When adding or changing user-facing text:

1. Add/update the key in `en.ts` (extend `Dict` if new).
2. Add the equivalent in **every** other locale file — TypeScript fails the build if a locale misses a key.
3. Use `t('your.key', { vars })` in components — never hardcode strings.
4. `.ts` library helpers return **keys** or structured data, not pre-localized strings — the component calls `t()`.
5. Tooltips (`title=`), `aria-label`, placeholders, toasts, document title, and error messages are user-facing too.

New locale: add to `LOCALES`, `LOCALE_NAMES`, and the `isLocale` predicate in `index.svelte.ts`, plus the new dict file.
