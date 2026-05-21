# Weather Voodoo — sharing kit

A one-page pitch you can paste into chats or hand to friends. Live app:
**https://weather-voodoo.vercel.app**

![Social card](static/og.png)

---

## What it does (in 30 seconds)

Picks the **best hours of the next 3 days** for a specific outdoor or marine
trip. Wind, gust, rain, wave height and visibility get blended into a single
**0–100 score** and the best contiguous windows are surfaced for you, per
day and overall.

Two modes:

- **Route** — pick a From and a To. Forecast is fused across 3 sample
  points along the line, taking the worst-case conditions hour-by-hour.
  Good for ferry/boat trips, kayak crossings, drives.
- **Fixed location** — one place. Good for a beach day, hike, sunset
  session.

Each row in the table is colour-coded by score, with the activity verdicts
("Good for ferry/boat trips. Avoid swimming, kayaking.") inline below.
Night hours are tinted darker; the time cell shows 🌅 / 🌇 markers on
the sunrise/sunset hours.

---

## Paste-ready demo links

- **Default landing page** — https://weather-voodoo.vercel.app
- **Phi Phi → Ao Nang, sea trip** —
  https://weather-voodoo.vercel.app/#f=7.7388,98.7784&fl=Phi+Phi&o=8.034,98.825&ol=Ao+Nang
- **Ao Nang, fixed location, land mode** —
  https://weather-voodoo.vercel.app/#t=fixed&a=8.034,98.825&al=Ao+Nang&md=land
- **Help / how to use it** — https://weather-voodoo.vercel.app/help

---

## Pitch you can copy into a message

> Found this — picks the best hours of the next 3 days for any outdoor or
> marine trip (ferry, kayak, hike, beach day). You give it a place or a
> route, it scores every hour 0–100 and tells you the best windows per day.
>
> https://weather-voodoo.vercel.app

Shorter:

> 🌦️ Best weather windows for the next 3 days, by hour, for any place or
> route. https://weather-voodoo.vercel.app

---

## Short demo video

Direct link (~1.8 MB MP4, generated with Gemini using the prompt below):
**https://weather-voodoo.vercel.app/promo.mp4**

Attach it to posts, embed it, or use it as the auto-playing media in
platforms that support it (Twitter, Discord, Telegram).

---

## Screenshots

Desktop (Route view, Tomorrow tab):

![Desktop](docs/promo/desktop.png)

Mobile (sticky header, score-coloured rows):

![Mobile](docs/promo/mobile.png)

---

## Install on your phone

It's a PWA — works offline after first load.

- **iOS Safari**: Share → *Add to Home Screen*.
- **Android Chrome**: ⋮ menu → *Install app*.
- **Desktop Chrome / Edge**: install icon in the address bar.

---

*Regenerate the OG card after any visual change with:*
`node /tmp/pw-debug/rasterize-og.mjs` *(if the helper is around) or commit
a fresh `static/og.png` by hand.*
