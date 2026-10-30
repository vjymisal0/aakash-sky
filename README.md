# Aakash · live satellites over India

A live satellite tracker for the Indian public. Every icon on the map is a real satellite, positioned in the browser from public orbital data. The first thing you see is the answer to the question most people actually have: **when can I see the space station from my city tonight?**

- **Over India now.** A live list of every satellite whose ground point is over India this moment, typically about 100 at once. Each card shows altitude, heading, speed, whether it is sunlit, and how long until it leaves India. Tap a card to fly to it, then **Track live** to keep the camera on it.
- **Spot it tonight.** Pick your city (or use your location) and get the next naked-eye passes for the next 7 days: when it appears, where to look, how high it climbs and when it fades. One tap adds a pass to your phone's calendar with a 10-minute reminder.
- **A map centred on India.** A dark map with English place labels, opening on India. Satellites are drawn as icons pointing in their direction of travel and coloured by layer: India (ISRO and Indian-owned), space stations, navigation, weather, Starlink, OneWeb, other. Indian satellites and space stations are larger and labelled. Starlink and OneWeb (about 70% of the fleet) start hidden so they do not bury everything else. **3D** switches to a globe, and **IN** flies back to India. Tap any satellite for its owner, launch date, orbit, live altitude and speed, and whether it is in sunlight. Links like `#sat=25544` open straight to one satellite, so they can be shared.
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
| Map | `src/skymap.ts` | MapLibre GL with the free OpenFreeMap dark style (no API key). Propagates about 2,500 satellites per animation frame and pushes only those in view to a GeoJSON source once a second. Shows the selected satellite's ground track, and dims satellites in Earth's shadow. |
| UI | `src/main.ts`, `src/style.css`, `src/i18n.ts` | No framework. All copy lives in `i18n.ts`. Mobile layout uses a bottom sheet. |
| Over India | `src/core/india.ts` | Coarse outline of India's official boundary plus island boxes, used only for grouping (never drawn). Crossing entry and exit are found by walking the ground track in 20 s steps. |
| Calendar | `src/core/ics.ts` | RFC 5545 export with a display alarm and UTF-8-safe line folding. |
| Offline | `public/sw.js` | App shell cache-first, orbital data network-first. |

## Accuracy

Pass times are checked in `tests/sky.test.ts` against [Skyfield](https://rhodesmill.org/skyfield/) 1.55 with the DE421 ephemeris, using the same orbital elements. Rise, culmination and set agree within 10 s and maximum elevation within 0.5°. Real-world accuracy is limited by how old the orbital elements are: SGP4 error grows by roughly a few km per day. This is fine for spotting satellites, but not for anything safety-critical.

The app does not compute brightness magnitudes. The ISS and Tiangong are labelled "very bright". Everything else in the visual list is labelled "naked-eye", which means it needs a dark sky.

## Data and credits

- Orbital elements and the satellite catalogue come from [CelesTrak](https://celestrak.org), maintained by Dr T.S. Kelso.
- Map tiles and style come from [OpenFreeMap](https://openfreemap.org), using © OpenMapTiles and © OpenStreetMap contributors data, rendered with [MapLibre GL JS](https://maplibre.org).
- Fonts are Space Grotesk, JetBrains Mono and Doto (SIL OFL), self-hosted through Fontsource.
- The interface patterns (live list, one-line status, single primary action, mobile tab bar) were inspired by [vimana.live](https://vimana.live).

Design notes: [`docs/design.md`](docs/design.md).
