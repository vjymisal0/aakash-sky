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
| Over India | Live list of satellites whose ground point is inside a coarse India outline | Answers "what is above us right now" the way a flight tracker lists aircraft in the airspace. |

## Out of scope for v1

- Accounts and any backend or database.
- Push notifications (planned v2: Cloudflare Worker cron + Web Push).
- Native apps, and AR "point your phone at the sky".
- Brightness magnitudes, debris, and decayed objects.
- Deep-space missions (Chandrayaan, Aditya-L1, Mars Orbiter). They have no Earth-orbit elements in GP data, so they cannot be shown.

## Hosting note

The repository is private, so GitHub Pages is not available on the free plan. Cloudflare Pages or Netlify can build private repos for free. Use `npm run build`, publish `dist/`, and schedule a rebuild every 2–6 hours to refresh orbits.
