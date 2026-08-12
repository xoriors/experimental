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

1. OpenStreetMap (via Overpass) supplies places nearby you can actually drive to. Two sorts: places
   to stand — marked viewpoints, car parks, lay-bys, summits (flagged, since they may need a walk) —
   and places to **settle in for an hour**: terraces with outdoor seating, beer gardens, hotels,
   guest houses, huts, campsites, parks. Terraces are required to have `outdoor_seating=yes`,
   because an indoor table facing east is no use at all.
2. For each one, the ground is sampled along the exact bearing the Sun will be on at that spot's
   best visible moment, out to 34 km, using Open-Meteo's Copernicus DEM.
3. The skyline angle is compared with the Sun's altitude, allowing for Earth curvature and standard
   refraction, and each place is graded from "clear view" to "terrain in the way".

Candidates are shortlisted by quota rather than by a plain ranking, so a town with three hundred
terraces still leaves room for the hilltop that might actually have the view.

Results are shown two ways at once: a list, and a map with every candidate plotted and coloured by
verdict, with a dashed ray from the selected spot showing exactly which way to look. Selecting a spot
also loads it into a **Google Maps panel in the page**, on satellite by default — which is the
fastest way to see the belt of trees or the barn that a 90 m elevation model cannot possibly know
about. Alongside it are links to driving directions and to Street View **already facing the
direction the Sun will set**.

The two maps come from different places on purpose. Plotting our own markers on a Google basemap
needs the Maps JavaScript API and a billable key, so the overview map is drawn from OpenStreetMap
tiles, where markers are ours to place; the Google panel carries a single pin and needs no key. The
elevation model knows about hills, not about trees or buildings, and the page says so.

Overpass is reached through `/api/viewing-spots` in preference to the browser, for three reasons:
most instances — including the canonical overpass-api.de — send no `Access-Control-Allow-Origin`
header, so a direct call to them fails as a CORS error; the server can identify itself as Overpass's
usage policy asks; and the answer is cached at the edge for a day, so a free shared service is not
queried once per visitor. The query is built server-side, so
the route cannot be used as an open proxy for arbitrary Overpass QL. It also checks that the
instance which replied is a real full-planet one: a regional mirror answers 200 with an empty list
for anywhere outside its own country, which would otherwise be shown as "no viewing spots found".

Overpass rations by IP, and a serverless function leaves through an address shared with every other
application on the platform, so its allowance is regularly spent by somebody else before our visitor
arrives — which is how a small query earns a gateway 504. The endpoint is built around that:

- Three full-planet mirrors are tried in turn, each with an eight-second slice of a 24-second
  budget. A mirror that has not answered in eight seconds is queueing, not thinking, and the next
  one is a better use of the time. They are ordered by what they measurably do: OSM France first
  (a query in the Carpathians in about a second, from a database minutes old), then the canonical
  overpass-api.de, then kumi.systems, which answers erratically and was three months behind when
  this was written. A mirror more than a year out of date is refused outright, and how far behind
  the answering one was comes back in a header.
- If all three refuse the full query, the two best are asked a deliberately cheaper one — fewer
  categories, a shorter drive. The page is told, via a response header, and says the list is reduced
  rather than presenting a thin result as the whole picture.
- The whole budget sits inside both the function's `maxDuration` and the browser's patience, so the
  page always receives the endpoint's own account of what happened — "overpass-api.de replied 429;
  kumi.systems ran out of time" — instead of a generic failure that names nobody.
- The query itself is written to be cheap, since its cost is what the user actually feels: `nwr`
  rather than paired node/way clauses, every venue clause led by the tag Overpass can index, named
  summits only, and per-category radius caps — nobody drives an hour to a car park.

There is a limit to what that buys, though, and measurement found it: from Vercel every mirror times
out, while the same query from an ordinary connection comes back in a second. Rationing by IP is not
something you can retry your way out of when the address is shared with the rest of the platform. So
the page runs both routes and takes whichever answers first — the endpoint immediately, and, if it
has not answered within three seconds, a direct call from the browser to OSM France, which alone
among the full-planet instances sends `Access-Control-Allow-Origin: *`. The endpoint keeps its head
start because it caches and identifies itself properly, so a healthy one means the browser never
makes a second request; when it cannot get through, the visitor's own connection has its own
allowance and a shorter path. If both fail, the endpoint's account of it is the one shown, because
it can name the mirror and the status where the browser only learns that it did not work.

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
pnpm test       # 126 tests, mostly against published eclipse predictions
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

The project uses `@sveltejs/adapter-vercel`. Every page is prerendered to static HTML; the only
server-side code is the `/api/viewing-spots` route, which becomes a single function. From this
directory:

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
- Viewing spots: OpenStreetMap contributors via [Overpass](https://overpass-api.de/) (ODbL), proxied through `/api/viewing-spots`; public instances run by OSM France, the Overpass project and Kumi Systems
- Spot map tiles: OpenStreetMap (ODbL); the Google Maps panel uses the keyless embed
- Ground elevation: [Open-Meteo elevation](https://open-meteo.com/en/docs/elevation-api), Copernicus DEM
- Cloud climatology: long-run August averages; see the caveat on `/where` — they are not a forecast
- Eye-safety guidance follows the AAS solar eclipse task force, NASA and the Royal Astronomical Society
