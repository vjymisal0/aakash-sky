# Aakash v1 design

Date: 2026-10-30

## Goal

Real-world impact for the Indian general public. Someone opens a link on a mid-range Android phone, picks their city, learns when the space station passes over tonight, steps outside and sees it. Seeing India's sky filled with live satellites is the hook that makes the link worth sharing.

Success means a first-time visitor reaches their next visible pass in under 10 seconds with no login. The map stays smooth on a mid-range phone.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Platform | Mobile-first static web app (PWA) | No install friction. Shareable on WhatsApp. Costs about ₹0 to host. |
| Data | CelesTrak GP (`active`, OMM CSV) + SATCAT, fetched at build time | Free and authoritative. CelesTrak forbids high-frequency polling, so browsers never call it. |
| Orbit maths | `satellite.js` SGP4 in the browser | No server. Positions stay live between data refreshes. |
| Map | MapLibre GL + OpenFreeMap dark style, India-centred, with a globe toggle | v1 used a three.js globe. Users could not find India among 15k dots, so it was replaced with a labelled map, following vimana.live. |
| Default layers | Starlink and OneWeb hidden | They are ~70% of the fleet and visually drown out Indian and visible satellites. |
| Visibility | Elevation ≥ 10°, sun ≤ −6°, satellite sunlit (`shadowFraction` < 0.5) | Standard naked-eye criteria. Conservative, so we do not send people out for passes in bright twilight. |
| Reminders | `.ics` download with a 10-minute alarm | Works on every phone with no backend or stored locations. Web push is deferred to v2. |
| Language | English only | Hindi was built and then removed at the owner's request. All copy stays in `src/i18n.ts`. |
| Location privacy | Geolocation rounded to 0.01° and stored only in `localStorage` | Pass times do not need more precision. Nothing leaves the device. |
| Look | Near-black, single saffron accent, Space Grotesk for prose, JetBrains Mono for data, Doto for headline numbers | Instrument-like and calm. Every pixel on screen is real data. |
| Over India | Map and list show only satellites whose ground point is inside India's outline (Natural Earth, India point of view) | Answers "what is above us right now" the way a flight tracker lists aircraft in the airspace. The official outline matters for an Indian public app. |
| Clutter | Unnamed objects (launch designator only) hidden by default | Real but meaningless to a casual viewer. |

## Out of scope for v1

- Accounts and any backend or database.
- Push notifications (planned v2: Cloudflare Worker cron + Web Push).
- Native apps, and AR "point your phone at the sky".
- Brightness magnitudes, debris, and decayed objects.
- Deep-space missions (Chandrayaan, Aditya-L1, Mars Orbiter). They have no Earth-orbit elements in GP data, so they cannot be shown.

## Hosting

- **App:** Netlify (https://aakash-sky.netlify.app), configured in `netlify.toml`. A production deploy costs 15 of the free plan's 300 monthly credits, so the site is rebuilt only when the code changes.
- **Orbit data:** `.github/workflows/data.yml` fetches CelesTrak every 3 hours and force-pushes `catalog.json` to the single-commit `data` branch. The app reads it from `raw.githubusercontent.com` and falls back to the copy bundled at build time. Refreshing data costs no Netlify credits.
- **Manual deploy:** `npx netlify-cli deploy --prod --dir dist` after `npm run build`.
- GitHub disables scheduled workflows after 60 days without repository activity. If the "updated" time in the footer turns red, re-enable the workflow in the Actions tab.
