import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/doto/700.css';
import '@fontsource/doto/900.css';
import './style.css';
import { decodeSat, periodMinutes, type Category, type RawCatalog, type RawSat, type Sat } from './core/catalog';
import { compass, isUnnamed, mission, orbitClass, OWNERS } from './core/describe';
import { toIcs } from './core/ics';
import { crossing, isOverIndia, subPoint, type Crossing } from './core/india';
import { isSunlit, satEci, type Observer, type Pass, type PassPoint } from './core/sky';
import { CITIES } from './data/cities';
import { CATEGORY_COLORS, SkyMap } from './skymap';
import { LOCALE, t, tBadge, tCategory, tMission } from './i18n';
import type { PassRequest, PassResponse } from './passes.worker';

const CATEGORY_ORDER: Category[] = ['india', 'station', 'starlink', 'gnss', 'weather', 'oneweb', 'other'];
const DEFAULT_LAYERS = CATEGORY_ORDER.filter((c) => c !== 'starlink' && c !== 'oneweb');
/** Order of the "Over India" list: what people care about first, the Starlink flood last. */
const LIST_PRIORITY: Category[] = ['station', 'india', 'weather', 'gnss', 'other', 'oneweb', 'starlink'];
/** ISS and Tiangong outshine everything else in the catalog. */
const VERY_BRIGHT = new Set([25544, 48274]);
const PASS_DAYS = 7;

type View = 'india' | 'tonight';
type Tab = 'globe' | View;

interface Place extends Observer {
  name: string;
  cityId?: string;
}

interface OverItem {
  sat: Sat;
  crossing: Crossing;
}

const state = {
  sats: [] as Sat[],
  raw: [] as RawSat[],
  byNorad: new Map<number, Sat>(),
  place: loadPlace(),
  passes: [] as Pass[],
  passesDone: false,
  // Starlink and OneWeb are ~70% of the fleet and bury everything else, so they start hidden.
  layers: new Set<Category>(DEFAULT_LAYERS),
  hideUnnamed: true,
  selected: null as Sat | null,
  following: false,
  overIndia: [] as OverItem[],
  listFilter: '',
  tab: (matchMedia('(max-width: 820px)').matches ? 'globe' : 'india') as Tab,
};
const crossings = new Map<number, Crossing>();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const isMobile = () => matchMedia('(max-width: 820px)').matches;

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
  return CITIES.find((c) => c.id === p.cityId)?.name ?? t('myLocation');
}

// ---------- formatting ----------

const fmtTime = (d: Date) => new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const fmtDay = (d: Date) => new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
const fmtNum = (n: number, digits = 0) => new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const tzName = () =>
  new Intl.DateTimeFormat(LOCALE, { timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';
const fmtLatLon = (lat: number, lon: number) =>
  `${fmtNum(Math.abs(lat), 1)}°${lat >= 0 ? 'N' : 'S'} ${fmtNum(Math.abs(lon), 1)}°${lon >= 0 ? 'E' : 'W'}`;

function untilText(ms: number) {
  if (ms <= 0) return t('now');
  const min = Math.round(ms / 60_000);
  if (min < 1) return '<1 min';
  if (min < 60) return t('inMin', { n: min });
  if (min < 24 * 60) return t('inHours', { h: Math.floor(min / 60), m: min % 60 });
  return t('inDays', { d: Math.floor(min / 1440), h: Math.floor((min % 1440) / 60) });
}

const countdown = (p: Pass) => untilText(p.start.time.getTime() - Date.now());

function leavesText(c: Crossing, now: Date) {
  if (!c.leaves) return t('stays');
  const ms = c.leaves.getTime() - now.getTime();
  return ms < 30_000 ? t('leavingNow') : t('leavesIn', { t: untilText(ms).replace(/^in /, '') });
}
const dir = (pt: PassPoint) => compass(pt.azimuth);
const durationMin = (p: Pass) => Math.max(1, Math.round((p.end.time.getTime() - p.start.time.getTime()) / 60_000));

/** Live state of one satellite: ground point, direction of travel, speed, sunlight. */
function liveState(sat: Sat, now = new Date()) {
  const p = subPoint(sat.satrec, now);
  const next = subPoint(sat.satrec, new Date(now.getTime() + 10_000));
  const eci = satEci(sat.satrec, now);
  const eci2 = satEci(sat.satrec, new Date(now.getTime() + 1000));
  if (!p || !next || !eci || !eci2) return null;
  const la1 = (p.lat * Math.PI) / 180;
  const la2 = (next.lat * Math.PI) / 180;
  const dLon = ((next.lon - p.lon) * Math.PI) / 180;
  const bearing = (Math.atan2(Math.sin(dLon) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon)) * 180) / Math.PI;
  return {
    ...p,
    heading: compass(bearing),
    speed: Math.hypot(eci2.x - eci.x, eci2.y - eci.y, eci2.z - eci.z),
    lit: isSunlit(eci, now),
  };
}

const MARK = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><ellipse cx="12" cy="12" rx="10.5" ry="4" transform="rotate(-24 12 12)"/><circle cx="21" cy="8" r="1.4" class="sat"/></svg>`;

// ---------- layout ----------

function renderShell() {
  $('#app').innerHTML = `
    <header class="bar">
      <div class="brand">
        ${MARK}
        <span class="wordmark">AAKASH</span>
        <span class="tagline">${esc(t('tagline'))}</span>
      </div>
      <nav class="nav" aria-label="Sections">
        <button type="button" data-tab="india">${esc(t('tabIndia'))}</button>
        <button type="button" data-tab="tonight">${esc(t('tabTonight'))}</button>
      </nav>
      <div class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
        <input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t('search'))}" />
        <kbd>Ctrl K</kbd>
        <ul id="results" class="results" hidden></ul>
      </div>
      <div class="bar-right">
        <span class="pill live"><i></i><span class="pill-label">${esc(t('live'))} ·</span> <b id="count">—</b></span>
        <span class="clock mono" id="clock"></span>
      </div>
    </header>
    <main class="layout">
      <aside class="panel" id="panel">
        <section class="view view-india">
          <div class="view-head">
            <div class="label">${esc(t('overIndiaTitle'))}</div>
            <div class="big-count"><b class="doto" id="india-count">—</b><span class="label">${esc(t('overhead'))}</span></div>
          </div>
          <label class="filter">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
            <input id="list-filter" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t('filterList'))}" />
          </label>
          <div class="label row"><span>${esc(t('live'))}</span><span id="india-found"></span></div>
          <div id="india-list" class="sat-list"></div>
        </section>
        <section class="view view-tonight">
          <div class="loc">
            <div class="label">${esc(t('location'))}</div>
            <div class="loc-row">
              <select id="city"></select>
              <button class="btn ghost icon" id="geo" type="button" title="${esc(t('useMyLocation'))}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/></svg>
              </button>
            </div>
            <div class="hint" id="geo-hint"></div>
          </div>
          <div id="hero"></div>
          <div class="upcoming">
            <div class="label row"><span>${esc(t('upcoming'))}</span><span class="mono dim" id="upcoming-count"></span></div>
            <div id="list"></div>
          </div>
        </section>
      </aside>
      <div class="stage">
        <div id="map"></div>
        <button type="button" class="overlay-chip" id="india-chip" data-tab="india"><i></i><span id="india-chip-text">—</span></button>
        <div class="chips" id="chips"></div>
        <div class="map-tools">
          <button type="button" class="btn ghost" id="near-me">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.2"/></svg>
            <span>${esc(t('nearMe'))}</span>
          </button>
          <button type="button" class="btn ghost icon-text" id="home" title="${esc(t('backToIndia'))}"><span class="mono">IN</span></button>
          <button type="button" class="btn ghost icon-text" id="projection" title="${esc(t('toggle3d'))}"><span class="mono">3D</span></button>
        </div>
        <div class="hover-tip" id="tip" hidden></div>
        <article class="info card" id="info" hidden></article>
        <footer class="attrib">
          <span>${esc(t('dataFrom'))} <a href="https://celestrak.org" target="_blank" rel="noopener">CelesTrak</a> · ${esc(t('updated'))} <span id="updated" class="mono">—</span></span>
          <span class="dim">${esc(t('notForSafety'))}</span>
        </footer>
      </div>
    </main>
    <nav class="tabbar" aria-label="Sections">
      <button type="button" data-tab="globe">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 2.6 14.6 0 17M12 3.5c-2.6 2.4-2.6 14.6 0 17"/></svg>
        <span>${esc(t('tabGlobe'))}</span>
      </button>
      <button type="button" data-tab="india">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.5"/><path d="M5 19 19 5M8 5h11v11"/></svg>
        <span>${esc(t('tabIndia'))}</span>
      </button>
      <button type="button" data-tab="tonight">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14.5A8 8 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/></svg>
        <span>${esc(t('tabTonight'))}</span>
      </button>
    </nav>
    <div class="boot" id="boot">
      <span class="doto wordmark-big">AAKASH</span>
      <span class="mono dim">${esc(t('booting'))}</span>
    </div>
    <div class="toast" id="toast" hidden></div>
    <div class="welcome" id="welcome" hidden>
      <div class="card">
        ${MARK.replace('class="mark"', 'class="mark big"')}
        <h1 class="doto">${esc(t('welcomeTitle'))}</h1>
        <p>${esc(t('welcomeBody'))}</p>
        <p class="small dim">${esc(t('welcomeNote'))}</p>
        <div class="actions">
          <button class="btn ghost" id="w-explore" type="button">${esc(t('explore'))}</button>
          <button class="btn primary" id="w-pass" type="button">${esc(t('findPass'))}</button>
        </div>
      </div>
    </div>
  `;
}

function setTab(tab: Tab) {
  // Desktop always shows the globe, so "globe" falls back to the list.
  if (!isMobile() && tab === 'globe') tab = 'india';
  state.tab = tab;
  document.body.dataset.tab = tab;
  document.querySelectorAll<HTMLElement>('button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
}

function renderCities() {
  const custom = state.place.cityId ? '' : `<option value="" selected>${esc(t('myLocation'))}</option>`;
  $<HTMLSelectElement>('#city').innerHTML =
    custom + CITIES.map((c) => `<option value="${c.id}" ${c.id === state.place.cityId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function renderChips() {
  const counts = new Map<Category, number>();
  for (const s of state.sats) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  const all = state.layers.size === CATEGORY_ORDER.length;
  $('#chips').innerHTML =
    `<button type="button" class="chip ${all ? 'on' : ''}" data-cat="all">${esc(t('all'))}</button>` +
    CATEGORY_ORDER.filter((c) => counts.get(c))
      .map(
        (c) => `<button type="button" class="chip ${state.layers.has(c) ? 'on' : ''}" data-cat="${c}">
          <i style="background:${CATEGORY_COLORS[c]}"></i>${esc(tCategory(c))}<span class="mono">${fmtNum(counts.get(c)!)}</span></button>`,
      )
      .join('') +
    `<button type="button" class="chip ${state.hideUnnamed ? '' : 'on'}" data-cat="unnamed" title="${esc(t('unnamedHint'))}"><i style="background:#5f636a"></i>${esc(
      t('unnamed'),
    )}<span class="mono">${fmtNum(state.sats.filter((s) => isUnnamed(s.name)).length)}</span></button>`;
}

// ---------- over India ----------

function refreshOverIndia() {
  const now = new Date();
  const found: OverItem[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < state.sats.length; i++) {
    if (!sky.isShown(i)) continue;
    const [lat, lon] = sky.approxLatLon(i);
    if (!isOverIndia(lat, lon)) continue;
    const sat = state.sats[i];
    let c = crossings.get(sat.norad);
    if (!c || (c.leaves && c.leaves.getTime() < now.getTime())) {
      c = crossing(sat.satrec, now);
      crossings.set(sat.norad, c);
    }
    seen.add(sat.norad);
    found.push({ sat, crossing: c });
  }
  for (const k of crossings.keys()) if (!seen.has(k)) crossings.delete(k);
  found.sort(
    (a, b) => LIST_PRIORITY.indexOf(a.sat.category) - LIST_PRIORITY.indexOf(b.sat.category) || a.sat.name.localeCompare(b.sat.name),
  );
  state.overIndia = found;
  renderOverIndia();
}

function renderOverIndia() {
  const n = state.overIndia.length;
  $('#india-count').textContent = state.sats.length ? fmtNum(n) : '—';
  $('#india-chip-text').textContent = t('overIndiaChip', { n: fmtNum(n) });
  const q = state.listFilter.trim().toUpperCase();
  const items = q ? state.overIndia.filter((x) => x.sat.name.includes(q) || String(x.sat.norad) === q) : state.overIndia;
  $('#india-found').textContent = t('found', { n: fmtNum(items.length) });
  const list = $('#india-list');
  if (!items.length) {
    list.innerHTML = `<p class="empty">${esc(q ? t('noMatch', { q: state.listFilter.trim() }) : t('noneOver'))}</p>`;
    return;
  }
  const now = new Date();
  // Cap the DOM: a phone does not need 300 cards; the filter reaches the rest.
  list.innerHTML = items.slice(0, 120).map((x) => satCard(x, now)).join('');
}

function satCard({ sat, crossing: c }: OverItem, now: Date) {
  const live = liveState(sat, now);
  if (!live) return '';
  const m = mission(sat);
  const total = c.leaves ? c.leaves.getTime() - c.entered.getTime() : 0;
  const pct = c.leaves && total > 0 ? Math.min(100, Math.max(4, ((now.getTime() - c.entered.getTime()) / total) * 100)) : 100;
  const leaves = leavesText(c, now);
  return `
    <article class="sat-card ${state.selected === sat ? 'on' : ''}" data-norad="${sat.norad}" tabindex="0">
      <span class="badge" style="--c:${CATEGORY_COLORS[sat.category]}">${tBadge(sat.category)}</span>
      <div class="sc-body">
        <div class="sc-top">
          <b class="mono name">${esc(sat.name)}</b>
          <span class="tag live">${esc(t('live'))}</span>
          <span class="sc-state ${live.lit ? 'lit' : ''}">${esc(live.lit ? t('sunlit') : t('shadow'))}</span>
        </div>
        <div class="sc-mid">
          <span class="doto num">${fmtNum(live.heightKm)}</span><small>km</small>
          <span class="arrow">→</span>
          <span class="doto num">${live.heading}</span>
          <span class="mono speed">${fmtNum(live.speed, 2)} km/s</span>
        </div>
        <div class="sc-sub">${esc(m ? tMission(m) : tCategory(sat.category))} · <span class="mono">${fmtLatLon(live.lat, live.lon)}</span></div>
        <div class="sc-bar"><span style="width:${pct}%"></span></div>
        <div class="sc-foot mono">${esc(leaves)}</div>
      </div>
    </article>`;
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
  return `<div class="stop"><b class="doto">${esc(fmtTime(pt.time))}</b><span class="mono">${esc(dir(pt))} ${fmtNum(pt.elevation)}°</span><small>${esc(label)}</small></div>`;
}

const upcomingPasses = () => state.passes.filter((p) => p.end.time.getTime() > Date.now());
const nextPassFor = (sat: Sat) => state.passes.find((p) => p.norad === sat.norad && p.end.time.getTime() > Date.now()) ?? null;

/** Hero prefers the next very-bright pass (ISS/Tiangong) within 48 h, else the next of anything. */
function heroPass(list: Pass[]) {
  const soon = list.filter((p) => p.start.time.getTime() - Date.now() < 48 * 3_600_000);
  return soon.find((p) => VERY_BRIGHT.has(p.norad)) ?? list[0] ?? null;
}

function renderPasses() {
  const list = upcomingPasses();
  const hero = heroPass(list);
  $('#hero').innerHTML = hero
    ? passCard(hero, true)
    : `<div class="pass hero empty"><div class="label">${esc(t('nextPass'))}</div><p>${esc(state.passesDone ? t('noPasses') : t('computing'))}</p>${
        state.passesDone ? '' : '<div class="loader"></div>'
      }</div>`;
  $('#list').innerHTML = list
    .filter((p) => p !== hero)
    .slice(0, 40)
    .map((p) => passCard(p, false))
    .join('');
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
    if (state.selected) renderInfo();
  };
  const { lat, lon } = state.place;
  worker.postMessage({ id, sats: visual, observer: { lat, lon }, from: Date.now() - 15 * 60_000, days: PASS_DAYS } satisfies PassRequest);
}

function downloadIcs(p: Pass) {
  const name = state.byNorad.get(p.norad)?.name ?? String(p.norad);
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
  setFollowing(false);
  sky.select(sat, fly);
  history.replaceState(null, '', sat ? `#sat=${sat.norad}` : location.pathname + location.search);
  renderInfo();
  document.querySelectorAll('.sat-card.on').forEach((el) => el.classList.remove('on'));
  if (sat) document.querySelector(`.sat-card[data-norad="${sat.norad}"]`)?.classList.add('on');
  if (sat && isMobile()) setTab('globe');
}

function setFollowing(on: boolean) {
  state.following = on;
  sky.follow(on ? state.selected : null);
  const b = document.getElementById('track');
  if (b) {
    b.classList.toggle('active', on);
    b.querySelector('span')!.textContent = on ? t('stopTracking') : t('trackLive');
  }
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
  const pass = nextPassFor(sat);
  el.innerHTML = `
    <header>
      <button type="button" class="btn ghost icon" id="info-close" aria-label="${esc(t('back'))}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <div class="info-title">
        <div class="label"><i class="dot" style="background:${CATEGORY_COLORS[sat.category]}"></i>${esc(tCategory(sat.category))}${m ? ` · ${esc(tMission(m))}` : ''}</div>
        <h2>${esc(sat.name)}</h2>
      </div>
      <button type="button" class="btn ghost icon" id="share" aria-label="${esc(t('share'))}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/></svg>
      </button>
    </header>
    <div class="statement">
      <div class="doto headline" id="info-headline"></div>
      <div class="sc-bar" id="info-bar" hidden><span></span></div>
      <p class="sub" id="info-sub"></p>
    </div>
    <button type="button" class="btn primary wide ${state.following ? 'active' : ''}" id="track">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg>
      <span>${esc(state.following ? t('stopTracking') : t('trackLive'))}</span>
    </button>
    ${
      pass
        ? `<div class="info-pass">${passCard(pass, false)}</div>`
        : ''
    }
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
  const live = liveState(sat, now);
  if (!live) return;
  el.innerHTML = `
    ${row(t('altitude'), `${fmtNum(live.heightKm)} km`)}
    ${row(t('speed'), `${fmtNum(live.speed, 2)} km/s`)}
    ${row(t('position'), fmtLatLon(live.lat, live.lon))}
    ${row(t('heading'), live.heading)}
    ${row(t('lighting'), live.lit ? t('inSunlight') : t('inShadow'), false)}
  `;

  // The one-line answer, like a flight tracker's "Arrives in 28m".
  const over = isOverIndia(live.lat, live.lon);
  const c = over ? (crossings.get(sat.norad) ?? crossing(sat.satrec, now)) : null;
  $('#info-headline').textContent = over ? t('overIndiaNow') : t('overPoint', { pos: fmtLatLon(live.lat, live.lon) });
  const bar = $('#info-bar');
  bar.hidden = !c?.leaves;
  if (c?.leaves) {
    const total = c.leaves.getTime() - c.entered.getTime();
    (bar.firstElementChild as HTMLElement).style.width = `${Math.min(100, Math.max(4, ((now.getTime() - c.entered.getTime()) / total) * 100))}%`;
  }
  const pass = nextPassFor(sat);
  const place = placeName(state.place);
  let sub = sat.visual
    ? pass
      ? t('visibleFrom', { place, when: countdown(pass) })
      : state.passesDone
        ? t('notVisibleWeek', { place })
        : t('computing')
    : t('tooFaint');
  if (c) sub = `${leavesText(c, now)} · ${sub}`;
  $('#info-sub').textContent = sub;
}

async function share() {
  const sat = state.selected;
  if (!sat) return;
  const url = `${location.origin}${location.pathname}#sat=${sat.norad}`;
  try {
    if (navigator.share) await navigator.share({ title: `${sat.name} · Aakash`, url });
    else {
      await navigator.clipboard.writeText(url);
      toast(t('linkCopied'));
    }
  } catch {
    // user cancelled the share sheet
  }
}

let toastTimer = 0;
function toast(msg: string) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 1800);
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
setTab(state.tab);

const sky = new SkyMap($('#map'), {
  onSelect: (s) => select(s),
  onFollowEnd: () => setFollowing(false),
  onHover: (sat, x, y) => {
    const tip = $('#tip');
    tip.hidden = !sat;
    if (!sat) return;
    const r = $('.stage').getBoundingClientRect();
    tip.style.transform = `translate(${x - r.left + 14}px, ${y - r.top + 14}px)`;
    tip.innerHTML = `<i class="dot" style="background:${CATEGORY_COLORS[sat.category]}"></i><b class="mono">${esc(sat.name)}</b><span class="dim">${esc(
      tCategory(sat.category),
    )}</span>`;
  },
});

function setPlace(p: Place) {
  state.place = p;
  localStorage.setItem('place', JSON.stringify(p));
  sky.setObserver(p.lat, p.lon);
  renderCities();
  if (state.raw.length) computePasses();
}

function applyLayers() {
  sky.setFilter((s) => state.layers.has(s.category) && !(state.hideUnnamed && isUnnamed(s.name)));
  renderChips();
  if (state.sats.length) refreshOverIndia();
}

function locate(after?: (lat: number, lon: number) => void) {
  const hint = $('#geo-hint');
  hint.textContent = t('locating');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      hint.textContent = '';
      // Round to ~1 km: plenty for pass times and avoids storing an exact home location.
      const lat = +pos.coords.latitude.toFixed(2);
      const lon = +pos.coords.longitude.toFixed(2);
      setPlace({ name: 'me', lat, lon });
      after?.(lat, lon);
    },
    () => {
      hint.textContent = t('locationDenied');
      toast(t('locationDenied'));
    },
    { timeout: 10_000, maximumAge: 3_600_000 },
  );
}

$('#chips').addEventListener('click', (e) => {
  const cat = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]')?.dataset.cat;
  if (!cat) return;
  const all = state.layers.size === CATEGORY_ORDER.length;
  // "All" flips between everything and the uncluttered default; other chips toggle one layer.
  if (cat === 'unnamed') state.hideUnnamed = !state.hideUnnamed;
  else if (cat === 'all') state.layers = all ? new Set(DEFAULT_LAYERS) : new Set(CATEGORY_ORDER);
  else {
    if (state.layers.has(cat as Category)) state.layers.delete(cat as Category);
    else state.layers.add(cat as Category);
    if (!state.layers.size) state.layers = new Set(DEFAULT_LAYERS);
  }
  applyLayers();
});

$('#city').addEventListener('change', (e) => {
  const c = CITIES.find((x) => x.id === (e.target as HTMLSelectElement).value);
  if (c) setPlace({ name: c.name, cityId: c.id, lat: c.lat, lon: c.lon });
});

$('#geo').addEventListener('click', () => locate());
$('#home').addEventListener('click', () => sky.home());
$('#projection').addEventListener('click', (e) => {
  const p = sky.toggleProjection();
  const b = e.currentTarget as HTMLElement;
  b.classList.toggle('on', p === 'globe');
  b.querySelector('span')!.textContent = p === 'globe' ? '2D' : '3D';
});
$('#near-me').addEventListener('click', () => {
  sky.flyToLatLon(state.place.lat, state.place.lon);
  locate((lat, lon) => sky.flyToLatLon(lat, lon));
});

const listFilter = $<HTMLInputElement>('#list-filter');
listFilter.addEventListener('input', () => {
  state.listFilter = listFilter.value;
  renderOverIndia();
});

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  // Only buttons: <body> also carries data-tab for CSS.
  const tab = target.closest<HTMLElement>('button[data-tab]')?.dataset.tab as Tab | undefined;
  if (tab) {
    setTab(tab);
    return;
  }
  const act = target.closest<HTMLElement>('[data-act]');
  const card = target.closest<HTMLElement>('.pass[data-norad]');
  if (act && card) {
    const pass = state.passes.find((p) => p.norad === Number(card.dataset.norad) && p.start.time.getTime() === Number(card.dataset.start));
    if (!pass) return;
    if (act.dataset.act === 'cal') downloadIcs(pass);
    if (act.dataset.act === 'show') select(state.byNorad.get(pass.norad) ?? null, true);
    return;
  }
  const satCardEl = target.closest<HTMLElement>('.sat-card[data-norad]');
  if (satCardEl) {
    select(state.byNorad.get(Number(satCardEl.dataset.norad)) ?? null, true);
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
  if (target.closest('#track')) setFollowing(!state.following);
  if (target.closest('#share')) share();
  if (!target.closest('.search')) $('#results').hidden = true;
});

document.addEventListener('keydown', (e) => {
  const card = (e.target as HTMLElement).closest?.('.sat-card[data-norad]') as HTMLElement | null;
  if (card && e.key === 'Enter') select(state.byNorad.get(Number(card.dataset.norad)) ?? null, true);
});

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

function maybeWelcome() {
  if (localStorage.getItem('welcomed')) return;
  const w = $('#welcome');
  w.hidden = false;
  const close = () => {
    w.hidden = true;
    localStorage.setItem('welcomed', '1');
  };
  $('#w-explore').addEventListener('click', close);
  $('#w-pass').addEventListener('click', () => {
    close();
    setTab('tonight');
  });
}

setInterval(() => {
  const now = new Date();
  $('#clock').textContent = `${fmtTime(now)}:${String(now.getSeconds()).padStart(2, '0')} ${tzName()}`;
  document.querySelectorAll<HTMLElement>('.pass[data-start]').forEach((card) => {
    const p = state.passes.find((x) => x.norad === Number(card.dataset.norad) && x.start.time.getTime() === Number(card.dataset.start));
    const cd = card.querySelector('[data-cd]');
    if (p && cd) cd.textContent = countdown(p);
  });
  updateInfoLive();
}, 1000);

// The list is cheap to rebuild from positions the globe already computed.
setInterval(() => state.sats.length && refreshOverIndia(), 2000);
// Drop finished passes once a minute.
setInterval(renderPasses, 60_000);

renderCities();
renderPasses();
sky.setObserver(state.place.lat, state.place.lon);
// Dev-only handle for profiling from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __sky: sky });

async function load() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/catalog.json`);
  const cat: RawCatalog = await res.json();
  state.raw = cat.sats;
  state.sats = cat.sats.flatMap((r) => {
    try {
      return [decodeSat(r)];
    } catch {
      return [];
    }
  });
  state.byNorad = new Map(state.sats.map((s) => [s.norad, s]));
  sky.setSatellites(state.sats);
  $('#count').textContent = fmtNum(state.sats.length);
  $('#updated').textContent = `${fmtDay(new Date(cat.generatedAt))} ${fmtTime(new Date(cat.generatedAt))}`;
  applyLayers();
  computePasses();
  $('#boot').classList.add('done');

  if (!openLinkedSat()) maybeWelcome();
  addEventListener('hashchange', openLinkedSat);
}

/** Deep link: #sat=25544 opens that satellite, so a shared link lands on it. */
function openLinkedSat() {
  const sat = state.byNorad.get(Number(new URLSearchParams(location.hash.slice(1)).get('sat')));
  if (sat && sat !== state.selected) select(sat, true);
  return !!sat;
}

load().catch((err) => {
  console.error(err);
  $('#count').textContent = '!';
  $('#boot').classList.add('done');
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
