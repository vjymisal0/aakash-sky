# Aakash · live satellites over India

A live 3D satellite tracker for the Indian public. Every dot on the globe is a real satellite, positioned in the browser from public orbital data. The first thing you see is the answer to the question most people actually have: **when can I see the space station from my city tonight?**

- **Spot it tonight.** Pick your city (or use your location) and get the next naked-eye passes for the next 7 days: when it appears, where to look, how high it climbs and when it fades. One tap adds a pass to your phone's calendar with a 10-minute reminder.
- **Explore the sky in 3D.** About 15,000 active satellites on a day/night globe, coloured by layer: India (ISRO and Indian-owned), space stations, Starlink, navigation, weather, OneWeb. Tap any dot for its owner, launch date, orbit, live altitude and speed, and whether it is in sunlight.
- **India first.** Indian satellites are their own layer, with mission types (NavIC navigation, Cartosat imaging, INSAT weather, and so on). There are 33 preset Indian cities, including Sriharikota.
- **Free, no login, no backend.** It is a static site. Orbital data is downloaded at build time and the orbit maths runs on your device.

## Run it locally

```sh
npm install
npm run dev     # downloads orbital data on first run, then serves http://localhost:5173
npm test        # unit tests, including pass predictions checked against Skyfield
npm run build   # production build in dist/
```

`npm run dev` and `npm run build` call `scripts/fetch-data.mjs` first. It writes `public/data/catalog.json` and skips the download when that file is under 2 hours old. Use `npm run data -- --force` to refresh sooner.

> **CelesTrak rate limit.** CelesTrak updates its data every 2 hours. If you download the same group twice within that window, it answers `403` with "GP data has not updated since your last successful download". Repeatedly ignoring that can get your IP blocked. The script keeps the previous catalog when this happens, so do not loop it.

## How it works

| Piece | File | Notes |
| --- | --- | --- |
| Data pipeline | `scripts/fetch-data.mjs`, `scripts/lib/catalog.mjs` | Downloads the CelesTrak `active` group in OMM CSV format and joins it with SATCAT for owner and launch date. Tags each satellite by layer and writes compact positional arrays. Uses OMM rather than TLE because NORAD IDs above 99999 now exist. |
| Orbit + sky maths | `src/core/sky.ts` | SGP4 via `satellite.js`. A pass is visible when the satellite is above 10°, the observer's sun is below −6° (civil twilight) and the satellite is sunlit. Coarse 60 s scan, then a 5 s walk through each pass. Dark windows are computed once per location and shared by every satellite. |
| Pass worker | `src/passes.worker.ts` | Predicts 7 days for all CelesTrak "visual" satellites off the main thread, streaming partial results so the hero card fills in first. |
| Globe | `src/globe.ts` | Plain three.js in an Earth-fixed frame, with a day/night shader driven by the real sun position. It propagates about 2,500 satellites per frame, so the whole fleet refreshes every few frames, and it dims satellites in Earth's shadow. |
| UI | `src/main.ts`, `src/style.css`, `src/i18n.ts` | No framework. All copy lives in `i18n.ts`. Mobile layout uses a bottom sheet. |
| Calendar | `src/core/ics.ts` | RFC 5545 export with a display alarm and UTF-8-safe line folding. |
| Offline | `public/sw.js` | App shell cache-first, orbital data network-first. |

## Accuracy

Pass times are checked in `tests/sky.test.ts` against [Skyfield](https://rhodesmill.org/skyfield/) 1.55 with the DE421 ephemeris, using the same orbital elements. Rise, culmination and set agree within 10 s and maximum elevation within 0.5°. Real-world accuracy is limited by how old the orbital elements are: SGP4 error grows by roughly a few km per day. This is fine for spotting satellites, but not for anything safety-critical.

The app does not compute brightness magnitudes. The ISS and Tiangong are labelled "very bright". Everything else in the visual list is labelled "naked-eye", which means it needs a dark sky.

## Data and credits

- Orbital elements and the satellite catalogue come from [CelesTrak](https://celestrak.org), maintained by Dr T.S. Kelso.
- Earth textures come from NASA Blue Marble and Black Marble imagery (public domain), via the [three-globe](https://github.com/vasturiano/three-globe) examples (MIT).
- Fonts are Space Grotesk and JetBrains Mono (SIL OFL), self-hosted through Fontsource.

Design notes: [`docs/design.md`](docs/design.md).
