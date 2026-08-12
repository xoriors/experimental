# solar-eclipse-2026

An interactive guide and physically-accurate simulator for the **total solar eclipse of 12 August
2026**, whose path of totality crosses the Arctic, eastern Greenland, western Iceland and northern
Spain.

Nothing on the site is a lookup table. Every contact time, duration, Sun altitude, obscuration
figure and path outline is solved in the browser from the eclipse's Besselian elements, so the prose,
the city tables, the map and the simulator can never drift out of step with one another.

## What's here

| Page | What it does |
| --- | --- |
| `/` | Live countdown, headline figures, and a narrative timeline of the shadow's 96-minute run across the Earth |
| `/simulator` | The main event: a computed sky view for any point on Earth at any instant, plus a map of the shadow. Search any town worldwide, click the map, or use your location |
| `/where` | City-by-city local times, totality durations, Sun altitude and August cloud climatology, plus a viewpoint finder that checks the terrain towards the setting Sun |
| `/safety` | How to watch without damaging your eyes |
| `/guide` | What totality actually looks like, planning, photography, FAQ, later eclipses |

## The simulator

The sky view is drawn from geometry rather than from an animation:

- The Sun is placed at its real altitude and azimuth, optionally corrected for atmospheric
  refraction — which matters here, because over Spain the Sun is only 2–12° above the horizon.
- The Moon is placed at its real offset from the Sun, at the correct size ratio, rotated by the
  **parallactic angle** so the bite appears at the right clock position for your latitude and the
  time of day.
- Sky brightness follows a perceptual curve, so nothing much appears to happen until roughly 90%
  coverage and the light then collapses — which is why a deep partial eclipse and a total one feel
  like different events.
- The Moon's limb is modelled as a slightly ragged outline with realistic relief (~0.1% of its
  radius), so **Baily's beads fall out of the geometry** at second and third contact rather than
  being faked.
- The chromosphere shows only as a short arc on the side where the limbs are nearly tangent, and the
  diamond ring sits at that point of tangency.
- Planets come from JPL's approximate Keplerian elements; stars from a bright-star catalogue. On this
  date Regulus sits about 9° from the Sun, with Jupiter and Mercury close in and Venus well up.
- The corona is the one deliberately artistic element — it cannot be predicted in advance. Its radial
  fall-off is the empirical Baumbach profile and its streamer structure is shaped for solar maximum,
  which is roughly where the Sun will be.

## Finding somewhere to stand

Choosing the right town is only half of it. With the Sun a couple of degrees up, a low ridge or a
line of poplars to the west removes the entire event, so `/where` includes a viewpoint finder:

1. OpenStreetMap (via Overpass) supplies places nearby you can actually drive to — marked
   viewpoints, car parks, picnic sites, lay-bys — plus summits, which are flagged because they may
   need a walk.
2. For each one, the ground is sampled along the exact bearing the Sun will be on at that spot's
   best visible moment, out to 34 km, using Open-Meteo's Copernicus DEM.
3. The skyline angle is compared with the Sun's altitude, allowing for Earth curvature and standard
   refraction, and each place is graded from "clear view" to "terrain in the way".

Each result links to Google Maps for driving directions, and to Street View **already facing the
direction the Sun will set** — which is the fastest way to spot the hedge that a 90 m elevation
model cannot see. The model knows about hills, not about trees or buildings, and the page says so.

## Accuracy

Elements are NASA/GSFC's for this eclipse, from the
[Five Millennium Canon of Solar Eclipses](https://eclipse.gsfc.nasa.gov/SEsearch/SEdata.php?Ecl=20260812)
(Espenak & Meeus). The maths follows the *Explanatory Supplement to the Astronomical Almanac*, ch. 8,
and Meeus, *Elements of Solar Eclipses 1951–2200*.

The test suite checks the implementation against independently published values:

| Quantity | Published | Computed |
| --- | --- | --- |
| Greatest eclipse | 65.2°N 25.2°W, 17:45:51 UT | matches to a few km |
| Central duration | 02m18s | 138.2 s |
| Path width there | 293.9 km | 296 km |
| Gamma | 0.8977 | 0.8977 |
| Moon/Sun diameter ratio | 1.0386 | 1.0386 |
| Umbra on Earth | ~16:58 – ~18:34 UT | 16:58:04 – 18:34:00 |
| First to last contact | 264 min | 262 min |
| A Coruña totality | ~76 s | 74 s |
| Bilbao totality | ~30 s | 32 s |
| Palma totality | ~1m36s | 96 s |
| Madrid | partial only | partial only |

Two subtleties are worth flagging, because getting them wrong silently moves the path by several
kilometres and flips edge cities from one side of the limit to the other:

1. **The ephemeris meridian.** NASA's tabulated `mu` is measured from a meridian sitting
   `1.002738 × ΔT` of rotation east of Greenwich, because the elements are a function of TT while
   Earth's rotation follows UT. Without that correction the whole path lands ~0.3° too far west,
   which put Bilbao outside the path and Madrid inside it — the opposite of reality.
2. **"Eclipse magnitude" is overloaded.** The figure NASA quotes for a central eclipse (1.0386 here)
   is the ratio of apparent diameters, not the standard magnitude formula. The site reports
   obscuration, magnitude and the diameter ratio separately.

The residual disagreement with NASA's published path coordinates is a few kilometres, which is below
the inherent uncertainty of the limits: mountains on the Moon's edge move the true boundary by a
kilometre or two anyway. The simulator says so when your position is that close to a limit.

Because of that, place search covers the whole world rather than a curated list, and every result
carries its own verdict as you type — searching "Romania" makes it immediately clear that Baia Mare
gets a third of the Sun covered while Bucharest and Constanta get nothing.

A third subtlety matters for readers east of the path. This eclipse happens around sunset over
Europe, and further east it finishes after the Sun has gone: Bucharest reaches 90% obscuration
geometrically, but all of that is below the horizon and an observer there sees a 0.4% nibble before
sunset. Every figure the site quotes is therefore the deepest point **that is actually above the
horizon**, and places where the Sun sets partway through are flagged as such.

## Development

```sh
pnpm install
pnpm dev        # dev server
pnpm test       # 97 tests, mostly against published eclipse predictions
pnpm check      # svelte-check
pnpm build      # production build
pnpm preview    # serve the production build
```

Stack: SvelteKit 2 + Svelte 5 (runes), TypeScript, canvas 2D for both the sky and the map. No API
keys anywhere. Network use is optional and degrades cleanly: a lazily-loaded Natural Earth coastline
file (~230 KB gzipped) for the map, Open-Meteo's keyless geocoding endpoint for place search, and —
only when you press the button — Overpass and Open-Meteo's elevation endpoint for the viewpoint
finder. Every one of them reports a readable error and leaves the rest of the site working.

## Deploying to Vercel

The project uses `@sveltejs/adapter-vercel` and every page is prerendered, so it deploys as static
assets. From this directory:

```sh
npx vercel link      # once, to create/attach the project
npx vercel --prod    # deploy
```

Or import `xoriors/experimental` in the Vercel dashboard and set **Root Directory** to
`solar-eclipse-2026`; the framework preset, build command and install command are already declared in
`vercel.json`.

## Sources

- Besselian elements and reference circumstances: NASA/GSFC, Espenak & Meeus
- Planetary positions: JPL approximate Keplerian elements (Standish), valid 1800–2050
- Coastlines: Natural Earth via `world-atlas`
- Place search: [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api), built on GeoNames (CC BY 4.0)
- Time zones from coordinates: `tz-lookup`
- Viewing spots: OpenStreetMap contributors via [Overpass](https://overpass-api.de/) (ODbL)
- Ground elevation: [Open-Meteo elevation](https://open-meteo.com/en/docs/elevation-api), Copernicus DEM
- Cloud climatology: long-run August averages; see the caveat on `/where` — they are not a forecast
- Eye-safety guidance follows the AAS solar eclipse task force, NASA and the Royal Astronomical Society
