// Downloads orbital elements + satellite catalog from CelesTrak and writes public/data/catalog.json.
// CelesTrak refreshes GP data roughly every 2 hours and blocks clients that poll faster,
// so this runs at build time (and on a schedule in CI), never from the browser.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './lib/catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/data/catalog.json');
const GP = 'https://celestrak.org/NORAD/elements/gp.php';
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
// Snapshot published every 3 h by .github/workflows/data.yml. Used when CelesTrak refuses
// this machine (it blocks some cloud build IPs), so a build never ships without data.
const SNAPSHOT = 'https://raw.githubusercontent.com/vjymisal0/aakash-sky/data/catalog.json';

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'aakash-sky (+https://github.com/vjymisal0/aakash-sky)' },
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  // 403 with this message means we already hold the latest data; retrying risks an IP ban.
  if (res.status === 403) throw new Error(`403 for ${url}: ${text.trim().replace(/\s+/g, ' ').slice(0, 160)}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  // CelesTrak answers some errors with HTTP 200 and a plain-text message.
  if (!text.includes(',')) throw new Error(`Unexpected response from ${url}: ${text.slice(0, 120)}`);
  return text;
}

async function main() {
  const force = process.argv.includes('--force');
  const existing = await stat(out).catch(() => null);
  if (!force && existing && Date.now() - existing.mtimeMs < MAX_AGE_MS) {
    console.log(`catalog.json is under 2h old, skipping download (use --force to refresh)`);
    return;
  }

  const group = (g) => get(`${GP}?GROUP=${g}&FORMAT=csv`);
  // Tag groups only colour and label satellites; losing one should not block a refresh.
  const tagGroup = (g) =>
    group(g).catch((err) => {
      console.warn(`Skipping ${g} tags: ${err.message}`);
      return '';
    });
  try {
    const [activeCsv, visual, stations, gnss, weather, satcatCsv] = await Promise.all([
      group('active'),
      tagGroup('visual'),
      tagGroup('stations'),
      tagGroup('gnss'),
      tagGroup('weather'),
      get('https://celestrak.org/pub/satcat.csv'),
    ]);
    const catalog = buildCatalog({
      activeCsv,
      satcatCsv,
      groupCsvs: { visual, stations, gnss, weather },
      generatedAt: new Date().toISOString(),
    });
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(catalog));
    console.log(`Wrote ${catalog.sats.length} satellites to ${out}`);
  } catch (err) {
    console.warn(`CelesTrak download failed (${err.message})`);
    const prev = existing ? JSON.parse(await readFile(out, 'utf8')) : null;
    const snap = process.argv.includes('--no-fallback') ? null : await snapshot();
    if (snap && (!prev || snap.generatedAt > prev.generatedAt)) {
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(snap));
      console.log(`Using published snapshot from ${snap.generatedAt} (${snap.sats.length} satellites)`);
      return;
    }
    // Keep serving the previous catalog if nothing newer is reachable.
    if (prev) {
      console.warn(`Keeping catalog from ${prev.generatedAt}`);
      return;
    }
    throw err;
  }
}

async function snapshot() {
  try {
    const res = await fetch(SNAPSHOT, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cat = await res.json();
    if (!Array.isArray(cat.sats) || !cat.generatedAt) throw new Error('unexpected format');
    return cat;
  } catch (err) {
    console.warn(`Snapshot download failed (${err.message})`);
    return null;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
