import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './style.css';
import { eciToGeodetic, gstime, degreesLat, degreesLong } from 'satellite.js';
import { decodeSat, periodMinutes, type Category, type RawCatalog, type RawSat, type Sat } from './core/catalog';
import { compass, mission, orbitClass, OWNERS } from './core/describe';
import { toIcs } from './core/ics';
import { isSunlit, satEci, type Observer, type Pass, type PassPoint } from './core/sky';
import { CITIES } from './data/cities';
import { CATEGORY_COLORS, Globe } from './globe';
import { LOCALE, t, tCategory, tMission } from './i18n';
import type { PassRequest, PassResponse } from './passes.worker';

const CATEGORY_ORDER: Category[] = ['india', 'station', 'starlink', 'gnss', 'weather', 'oneweb', 'other'];
/** ISS and Tiangong outshine everything else in the catalog. */
const VERY_BRIGHT = new Set([25544, 48274]);
const PASS_DAYS = 7;

interface Place extends Observer {
  name: string;
  cityId?: string;
}

const state = {
  sats: [] as Sat[],
  raw: [] as RawSat[],
  byNorad: new Map<number, Sat>(),
  generatedAt: '',
  place: loadPlace(),
  passes: [] as Pass[],
  passesDone: false,
  layers: new Set<Category>(CATEGORY_ORDER),
  selected: null as Sat | null,
  selectedPass: null as Pass | null | undefined,
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function loadPlace(): Place {
  try {
    const p = JSON.parse(localStorage.getItem('place') ?? '');
    if (typeof p.lat === 'number' && typeof p.lon === 'number') return p;
  } catch {
    // first visit
  }
  const d = CITIES[0];
  return { name: d.name, cityId: d.id, lat: d.lat, lon: d.lon };
}

function placeName(p: Place) {
  const city = CITIES.find((c) => c.id === p.cityId);
  if (city) return city.name;
  return t('myLocation');
}

// ---------- formatting ----------

const fmtTime = (d: Date) => new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const fmtDay = (d: Date) => new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
const fmtNum = (n: number, digits = 0) => new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const tzName = () =>
  new Intl.DateTimeFormat('en-IN', { timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';

function countdown(p: Pass, now = Date.now()) {
  const ms = p.start.time.getTime() - now;
  if (ms <= 0) return t('now');
  const min = Math.round(ms / 60_000);
  if (min < 60) return t('inMin', { n: min });
  if (min < 24 * 60) return t('inHours', { h: Math.floor(min / 60), m: min % 60 });
  return t('inDays', { d: Math.floor(min / 1440), h: Math.floor((min % 1440) / 60) });
}

const dir = (pt: PassPoint) => compass(pt.azimuth);
const durationMin = (p: Pass) => Math.max(1, Math.round((p.end.time.getTime() - p.start.time.getTime()) / 60_000));

// ---------- layout ----------

function renderShell() {
  $('#app').innerHTML = `
    <header class="bar">
      <div class="brand">
        <svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><ellipse cx="12" cy="12" rx="10.5" ry="4" transform="rotate(-24 12 12)"/><circle cx="21" cy="8" r="1.4" class="sat"/></svg>
        <span class="wordmark">AAKASH</span>
        <span class="tagline" data-t="tagline"></span>
      </div>
      <div class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
        <input id="q" type="search" autocomplete="off" spellcheck="false" />
        <kbd>Ctrl K</kbd>
        <ul id="results" class="results" hidden></ul>
      </div>
      <div class="bar-right">
        <span class="pill live"><i></i><span class="pill-label"><span data-t="live"></span> ·</span> <b id="count">—</b></span>
        <span class="clock mono" id="clock"></span>
      </div>
    </header>
    <main class="layout">
      <aside class="panel" id="panel">
        <div class="grab" aria-hidden="true"></div>
        <section class="loc">
          <div class="label" data-t="location"></div>
          <div class="loc-row">
            <select id="city"></select>
            <button class="btn ghost icon" id="geo" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/></svg>
            </button>
          </div>
          <div class="hint" id="geo-hint"></div>
        </section>
        <section id="hero"></section>
        <section class="upcoming">
          <div class="label row"><span data-t="upcoming"></span><span class="mono dim" id="upcoming-count"></span></div>
          <div id="list"></div>
        </section>
      </aside>
      <div class="stage">
        <div id="globe"></div>
        <div class="chips" id="chips"></div>
        <article class="info card" id="info" hidden></article>
        <footer class="attrib">
          <span><span data-t="dataFrom"></span> <a href="https://celestrak.org" target="_blank" rel="noopener">CelesTrak</a> · <span data-t="updated"></span> <span id="updated" class="mono">—</span></span>
          <span class="dim" data-t="notForSafety"></span>
        </footer>
      </div>
    </main>
    <div class="welcome" id="welcome" hidden>
      <div class="card">
        <svg class="mark big" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><ellipse cx="12" cy="12" rx="10.5" ry="4" transform="rotate(-24 12 12)"/><circle cx="21" cy="8" r="1.4" class="sat"/></svg>
        <h1 data-t="welcomeTitle"></h1>
        <p data-t="welcomeBody"></p>
        <p class="small dim" data-t="welcomeNote"></p>
        <div class="actions">
          <button class="btn ghost" id="w-explore" type="button" data-t="explore"></button>
          <button class="btn primary" id="w-pass" type="button" data-t="findPass"></button>
        </div>
      </div>
    </div>
  `;
}

function applyStrings() {
  document.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
    el.textContent = t(el.dataset.t as Parameters<typeof t>[0]);
  });
  $<HTMLInputElement>('#q').placeholder = t('search');
  $('#geo').title = t('useMyLocation');
  renderCities();
  renderChips();
  renderPasses();
  renderInfo();
}

function renderCities() {
  const sel = $<HTMLSelectElement>('#city');
  const custom = state.place.cityId ? '' : `<option value="" selected>${esc(t('myLocation'))}</option>`;
  sel.innerHTML =
    custom +
    CITIES.map((c) => `<option value="${c.id}" ${c.id === state.place.cityId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function renderChips() {
  const counts = new Map<Category, number>();
  for (const s of state.sats) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  const all = state.layers.size === CATEGORY_ORDER.length;
  $('#chips').innerHTML =
    `<button type="button" class="chip ${all ? 'on' : ''}" data-cat="all">${esc(t('all'))}</button>` +
    CATEGORY_ORDER.filter((c) => counts.get(c))
      .map(
        (c) => `<button type="button" class="chip ${state.layers.has(c) && !all ? 'on' : ''}" data-cat="${c}">
          <i style="background:${CATEGORY_COLORS[c]}"></i>${esc(tCategory(c))}<span class="mono">${fmtNum(counts.get(c)!)}</span></button>`,
      )
      .join('');
}

// ---------- passes ----------

function passCard(p: Pass, hero: boolean) {
  const sat = state.byNorad.get(p.norad);
  const name = sat?.name ?? String(p.norad);
  const bright = VERY_BRIGHT.has(p.norad);
  return `
    <article class="pass ${hero ? 'hero' : ''}" data-norad="${p.norad}" data-start="${p.start.time.getTime()}">
      <header>
        <div>
          ${hero ? `<div class="label">${esc(t('nextPass'))}</div>` : ''}
          <h3>${esc(name)}</h3>
        </div>
        <span class="tag ${bright ? 'bright' : ''}">${esc(bright ? t('veryBright') : t('visible'))}</span>
      </header>
      <div class="when mono"><span class="day">${esc(fmtDay(p.start.time))}</span><span class="cd" data-cd>${esc(countdown(p))}</span></div>
      <div class="track">
        ${trackStop(p.start, t('appears'))}
        <span class="arc" aria-hidden="true"></span>
        ${trackStop(p.max, t('highest'))}
        <span class="arc" aria-hidden="true"></span>
        ${trackStop(p.end, t('disappears'))}
      </div>
      <div class="bar-el" aria-hidden="true"><span style="width:${Math.min(100, (p.max.elevation / 90) * 100)}%"></span></div>
      <footer>
        <span class="mono dim">${esc(t('minutes', { n: durationMin(p) }))} · ${fmtNum(p.max.elevation)}°</span>
        <span class="actions">
          <button type="button" class="btn ghost sm" data-act="cal">${esc(t('addCalendar'))}</button>
          <button type="button" class="btn ${hero ? 'primary' : 'ghost'} sm" data-act="show">${esc(t('showOnGlobe'))}</button>
        </span>
      </footer>
    </article>`;
}

function trackStop(pt: PassPoint, label: string) {
  return `<div class="stop"><b class="mono">${esc(fmtTime(pt.time))}</b><span class="mono">${esc(dir(pt))} ${fmtNum(pt.elevation)}°</span><small>${esc(label)}</small></div>`;
}

function upcomingPasses() {
  const now = Date.now();
  return state.passes.filter((p) => p.end.time.getTime() > now);
}

/** Hero prefers the next very-bright pass (ISS/Tiangong) within 48 h, else the next of anything. */
function heroPass(list: Pass[]) {
  const soon = list.filter((p) => p.start.time.getTime() - Date.now() < 48 * 3_600_000);
  return soon.find((p) => VERY_BRIGHT.has(p.norad)) ?? list[0] ?? null;
}

function renderPasses() {
  const list = upcomingPasses();
  const hero = heroPass(list);
  const heroEl = $('#hero');
  if (hero) heroEl.innerHTML = passCard(hero, true);
  else
    heroEl.innerHTML = `<div class="pass hero empty"><div class="label">${esc(t('nextPass'))}</div><p>${esc(
      state.passesDone ? t('noPasses') : t('computing'),
    )}</p>${state.passesDone ? '' : '<div class="loader"></div>'}</div>`;

  const rest = list.filter((p) => p !== hero).slice(0, 40);
  $('#list').innerHTML = rest.map((p) => passCard(p, false)).join('');
  $('#upcoming-count').textContent = list.length ? fmtNum(list.length) : '';
}

let worker: Worker | null = null;
let requestId = 0;

function computePasses() {
  worker?.terminate();
  worker = new Worker(new URL('./passes.worker.ts', import.meta.url), { type: 'module' });
  const id = ++requestId;
  state.passes = [];
  state.passesDone = false;
  renderPasses();
  // Very bright ones first so the hero card is ready almost immediately.
  const visual = state.raw.filter((r) => r[16] & 1).sort((a, b) => Number(VERY_BRIGHT.has(b[1])) - Number(VERY_BRIGHT.has(a[1])));
  worker.onmessage = (e: MessageEvent<PassResponse>) => {
    if (e.data.id !== id) return;
    state.passes = e.data.passes;
    state.passesDone = e.data.done;
    renderPasses();
    if (state.selected && !state.selectedPass) {
      state.selectedPass = state.passes.find((p) => p.norad === state.selected!.norad && p.end.time.getTime() > Date.now());
      if (state.selectedPass) renderInfo();
    }
  };
  const { lat, lon } = state.place;
  worker.postMessage({ id, sats: visual, observer: { lat, lon }, from: Date.now() - 15 * 60_000, days: PASS_DAYS } satisfies PassRequest);
}

function downloadIcs(p: Pass) {
  const sat = state.byNorad.get(p.norad);
  const name = sat?.name ?? String(p.norad);
  const vars = { name, from: dir(p.start), to: dir(p.end), el: fmtNum(p.max.elevation), max: dir(p.max), start: fmtTime(p.start.time), place: placeName(state.place) };
  const ics = toIcs({
    uid: `${p.norad}-${p.start.time.getTime()}@aakash`,
    start: p.start.time,
    end: p.end.time,
    title: t('calendarTitle', vars),
    description: t('calendarBody', vars),
    alarmMinutes: 10,
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `${name.replace(/[^\w]+/g, '-').toLowerCase()}-${p.start.time.toISOString().slice(0, 16).replace(':', '')}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- selected satellite ----------

function select(sat: Sat | null, fly = false) {
  state.selected = sat;
  state.selectedPass = sat ? state.passes.find((p) => p.norad === sat.norad && p.end.time.getTime() > Date.now()) : null;
  globe.select(sat, fly);
  renderInfo();
  if (sat && matchMedia('(max-width: 820px)').matches) $('#panel').classList.add('collapsed');
}

function renderInfo() {
  const el = $('#info');
  const sat = state.selected;
  if (!sat) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const m = mission(sat);
  const owner = OWNERS[sat.owner] ?? sat.owner;
  el.innerHTML = `
    <header>
      <div>
        <div class="label"><i class="dot" style="background:${CATEGORY_COLORS[sat.category]}"></i>${esc(tCategory(sat.category))}${m ? ` · ${esc(tMission(m))}` : ''}</div>
        <h2>${esc(sat.name)}</h2>
      </div>
      <button type="button" class="btn ghost icon" id="info-close" aria-label="${esc(t('close'))}">×</button>
    </header>
    <dl class="grid live" id="info-live"></dl>
    <dl class="grid">
      ${row(t('norad'), String(sat.norad))}
      ${row(t('cospar'), sat.objectId)}
      ${owner ? row(t('owner'), owner, false) : ''}
      ${sat.launchDate ? row(t('launched'), sat.launchDate) : ''}
      ${row(t('orbit'), orbitClass(sat.meanMotion, sat.eccentricity))}
      ${row(t('period'), `${fmtNum(periodMinutes(sat), 1)} min`)}
      ${row(t('inclination'), `${fmtNum(sat.inclination, 1)}°`)}
      ${row(t('elementsAge'), t('hoursAgo', { n: fmtNum((Date.now() - Date.parse(sat.epoch + 'Z')) / 3_600_000) }))}
    </dl>
    ${state.selectedPass ? `<div class="info-pass">${passCard(state.selectedPass, false)}</div>` : ''}
  `;
  updateInfoLive();
}

function row(k: string, v: string, mono = true) {
  return `<div><dt>${esc(k)}</dt><dd class="${mono ? 'mono' : ''}">${esc(v)}</dd></div>`;
}

function updateInfoLive() {
  const sat = state.selected;
  const el = document.getElementById('info-live');
  if (!sat || !el) return;
  const now = new Date();
  const eci = satEci(sat.satrec, now);
  if (!eci) return;
  const geo = eciToGeodetic(eci, gstime(now));
  const next = satEci(sat.satrec, new Date(now.getTime() + 1000));
  const speed = next ? Math.hypot(next.x - eci.x, next.y - eci.y, next.z - eci.z) : 0;
  const lat = degreesLat(geo.latitude);
  const lon = degreesLong(geo.longitude);
  el.innerHTML = `
    ${row(t('altitude'), `${fmtNum(geo.height)} km`)}
    ${row(t('speed'), `${fmtNum(speed, 2)} km/s`)}
    ${row(t('position'), `${fmtNum(Math.abs(lat), 2)}°${lat >= 0 ? 'N' : 'S'} ${fmtNum(Math.abs(lon), 2)}°${lon >= 0 ? 'E' : 'W'}`)}
    ${row(t('lighting'), isSunlit(eci, now) ? t('sunlit') : t('shadow'), false)}
  `;
}

// ---------- search ----------

function search(q: string) {
  const ul = $('#results');
  q = q.trim().toUpperCase();
  if (!q) {
    ul.hidden = true;
    return;
  }
  const id = Number(q);
  const hits = state.sats
    .filter((s) => (Number.isInteger(id) && s.norad === id) || s.name.includes(q))
    // Exact-prefix and India matches first; that is what this audience types.
    .sort((a, b) => Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)) || Number(b.category === 'india') - Number(a.category === 'india'))
    .slice(0, 8);
  ul.innerHTML = hits.length
    ? hits
        .map(
          (s) =>
            `<li><button type="button" data-norad="${s.norad}"><i class="dot" style="background:${CATEGORY_COLORS[s.category]}"></i><span>${esc(
              s.name,
            )}</span><span class="mono dim">${s.norad}</span></button></li>`,
        )
        .join('')
    : `<li class="none">${esc(t('noResults'))}</li>`;
  ul.hidden = false;
}

// ---------- wiring ----------

renderShell();

const globe = new Globe($('#globe'), { onSelect: (s) => select(s) });

function setPlace(p: Place) {
  state.place = p;
  localStorage.setItem('place', JSON.stringify(p));
  globe.setObserver(p.lat, p.lon);
  renderCities();
  if (state.raw.length) computePasses();
}

function applyLayers() {
  globe.setFilter((s) => state.layers.has(s.category));
  renderChips();
}

$('#chips').addEventListener('click', (e) => {
  const cat = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]')?.dataset.cat;
  if (!cat) return;
  const all = state.layers.size === CATEGORY_ORDER.length;
  if (cat === 'all') state.layers = new Set(CATEGORY_ORDER);
  else if (all) state.layers = new Set([cat as Category]);
  else {
    state.layers.has(cat as Category) ? state.layers.delete(cat as Category) : state.layers.add(cat as Category);
    if (!state.layers.size) state.layers = new Set(CATEGORY_ORDER);
  }
  applyLayers();
});

$('#city').addEventListener('change', (e) => {
  const c = CITIES.find((x) => x.id === (e.target as HTMLSelectElement).value);
  if (c) setPlace({ name: c.name, cityId: c.id, lat: c.lat, lon: c.lon });
});

$('#geo').addEventListener('click', () => {
  const hint = $('#geo-hint');
  hint.textContent = t('locating');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      hint.textContent = '';
      // Round to ~1 km: plenty for pass times and avoids storing an exact home location.
      setPlace({ name: 'me', lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2) });
    },
    () => (hint.textContent = t('locationDenied')),
    { timeout: 10_000, maximumAge: 3_600_000 },
  );
});

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const act = target.closest<HTMLElement>('[data-act]');
  const card = target.closest<HTMLElement>('.pass[data-norad]');
  if (act && card) {
    const pass = state.passes.find((p) => p.norad === Number(card.dataset.norad) && p.start.time.getTime() === Number(card.dataset.start));
    if (!pass) return;
    if (act.dataset.act === 'cal') downloadIcs(pass);
    if (act.dataset.act === 'show') select(state.byNorad.get(pass.norad) ?? null, true);
    return;
  }
  const res = target.closest<HTMLElement>('#results [data-norad]');
  if (res) {
    select(state.byNorad.get(Number(res.dataset.norad)) ?? null, true);
    $('#results').hidden = true;
    $<HTMLInputElement>('#q').value = '';
    return;
  }
  if (target.closest('#info-close')) select(null);
  if (!target.closest('.search')) $('#results').hidden = true;
});

$('#panel .grab').addEventListener('click', () => $('#panel').classList.toggle('collapsed'));

const q = $<HTMLInputElement>('#q');
q.addEventListener('input', () => search(q.value));
q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ($('#results').querySelector('button') as HTMLButtonElement | null)?.click();
  if (e.key === 'Escape') q.blur();
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    q.focus();
  }
  if (e.key === 'Escape' && document.activeElement !== q) select(null);
});

if (!localStorage.getItem('welcomed')) {
  const w = $('#welcome');
  w.hidden = false;
  const close = () => {
    w.hidden = true;
    localStorage.setItem('welcomed', '1');
  };
  $('#w-explore').addEventListener('click', close);
  $('#w-pass').addEventListener('click', () => {
    close();
    $('#panel').classList.remove('collapsed');
    $('#hero').scrollIntoView({ behavior: 'smooth' });
  });
}

setInterval(() => {
  $('#clock').textContent = `${fmtTime(new Date())}:${String(new Date().getSeconds()).padStart(2, '0')} ${tzName()}`;
  document.querySelectorAll<HTMLElement>('.pass[data-start]').forEach((card) => {
    const p = state.passes.find((x) => x.norad === Number(card.dataset.norad) && x.start.time.getTime() === Number(card.dataset.start));
    const cd = card.querySelector('[data-cd]');
    if (p && cd) cd.textContent = countdown(p);
  });
  updateInfoLive();
}, 1000);

// Drop finished passes once a minute.
setInterval(renderPasses, 60_000);

applyStrings();
globe.setObserver(state.place.lat, state.place.lon);

async function load() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/catalog.json`);
  const cat: RawCatalog = await res.json();
  state.raw = cat.sats;
  state.generatedAt = cat.generatedAt;
  state.sats = cat.sats.flatMap((r) => {
    try {
      return [decodeSat(r)];
    } catch {
      return [];
    }
  });
  state.byNorad = new Map(state.sats.map((s) => [s.norad, s]));
  globe.setSatellites(state.sats);
  $('#count').textContent = fmtNum(state.sats.length);
  $('#updated').textContent = `${fmtDay(new Date(cat.generatedAt))} ${fmtTime(new Date(cat.generatedAt))}`;
  applyLayers();
  computePasses();
}

load().catch((err) => {
  console.error(err);
  $('#count').textContent = '!';
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

