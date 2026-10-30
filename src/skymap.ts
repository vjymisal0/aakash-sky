// India-first dark map of the live fleet, built on MapLibre (2D by default, globe on demand).
// Positions are propagated here in small chunks per animation frame, then pushed to a
// GeoJSON source once a second for the satellites inside the current view.
import { MapLibreMap, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
// Vite pre-bundles maplibre-gl, which breaks its relative worker URL; point it at the file explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { degreesLat, degreesLong, eciToEcf, eciToGeodetic, gstime, jday, shadowFraction, sunPos } from 'satellite.js';
import type { Category, Sat } from './core/catalog';
import { periodMinutes } from './core/catalog';
import { INDIA_BOUNDS, INDIA_OUTLINE, isOverIndia } from './core/india';
import { satEci } from './core/sky';

export const CATEGORY_COLORS: Record<Category, string> = {
  station: '#ffffff',
  india: '#ff9f1c',
  gnss: '#3ddc97',
  weather: '#4cc9f0',
  starlink: '#8d86ff',
  oneweb: '#f072b6',
  other: '#c3c8cf',
};

setWorkerUrl(workerUrl);

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const INDIA_BOX: [[number, number], [number, number]] = [
  [INDIA_BOUNDS.west, INDIA_BOUNDS.south],
  [INDIA_BOUNDS.east, INDIA_BOUNDS.north],
];
/** Room for the top bar, layer chips and (on phones) the floating tab bar. */
const fitPadding = () =>
  matchMedia('(max-width: 820px)').matches
    ? { top: 100, bottom: 110, left: 12, right: 12 }
    : { top: 70, bottom: 80, left: 40, right: 40 };
const EMPHASIS = ['match', ['get', 'cat'], 'station', 1.6, 'india', 1.4, 1] as unknown as ExpressionSpecification;
/** Labels are reserved for the few satellites people look for by name. */
const LABELLED: Category[] = ['station', 'india'];

export interface MapEvents {
  onSelect(sat: Sat | null): void;
  /** Fired when the user drags the map while it was following a satellite. */
  onFollowEnd(): void;
  /** Mouse hover over a satellite (desktop only); null when the pointer leaves it. */
  onHover(sat: Sat | null, clientX: number, clientY: number): void;
}

type Projection = 'mercator' | 'globe';

export class SkyMap {
  private map: MapLibreMap;
  private ready = false;
  private sats: Sat[] = [];
  private index = new Map<Sat, number>();
  private lat = new Float32Array(0);
  private lon = new Float32Array(0);
  private heading = new Float32Array(0);
  private lit = new Uint8Array(0);
  private shown = new Uint8Array(0);
  private cursor = 0;
  /** Satellites propagated per animation frame; the full fleet refreshes every few frames. */
  private budget = 2500;
  private selected: Sat | null = null;
  private following: Sat | null = null;
  private observer: [number, number] | null = null;
  private events: MapEvents;
  private projection: Projection = 'mercator';

  constructor(host: HTMLElement, events: MapEvents) {
    this.events = events;
    this.map = new MapLibreMap({
      container: host,
      style: STYLE_URL,
      bounds: INDIA_BOX,
      fitBoundsOptions: { padding: fitPadding() },
      minZoom: 1.2,
      maxZoom: 9,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    this.map.touchZoomRotate.disableRotation();

    this.map.on('load', () => this.setupLayers());
    this.map.on('dragstart', () => {
      if (!this.following) return;
      this.following = null;
      this.events.onFollowEnd();
    });

    const loop = () => {
      this.propagateChunk();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    setInterval(() => this.push(), 1000);
  }

  private setupLayers() {
    const map = this.map;
    // The base style prints every place in Latin + native script; one English label is calmer.
    for (const layer of map.getStyle().layers) {
      if (layer.type !== 'symbol' || !layer.layout?.['text-field']) continue;
      if (layer.id.startsWith('highway')) map.setLayoutProperty(layer.id, 'visibility', 'none');
      else map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']]);
    }
    map.addImage('sat', satelliteIcon(), { sdf: true, pixelRatio: 2 });
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

    // Only India's sky is shown, so fade the rest of the world and outline India in saffron.
    const holes = INDIA_OUTLINE.geometry.coordinates.map((poly) => poly[0]);
    map.addSource('outside-india', {
      type: 'geojson',
      data: {
        type: 'Polygon',
        coordinates: [
          [
            [-180, -85],
            [180, -85],
            [180, 85],
            [-180, 85],
            [-180, -85],
          ],
          ...holes,
        ],
      },
    });
    map.addSource('india', { type: 'geojson', data: INDIA_OUTLINE });
    map.addLayer({ id: 'outside-india', type: 'fill', source: 'outside-india', paint: { 'fill-color': '#050607', 'fill-opacity': 0.62 } });
    map.addLayer({ id: 'india-fill', type: 'fill', source: 'india', paint: { 'fill-color': '#ffb13b', 'fill-opacity': 0.025 } });
    map.addLayer({
      id: 'india-border',
      type: 'line',
      source: 'india',
      paint: { 'line-color': '#ffb13b', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 7, 1.6] },
    });
    for (const id of ['sats', 'track', 'selected', 'me']) map.addSource(id, { type: 'geojson', data: empty });

    const color = ['match', ['get', 'cat'], ...Object.entries(CATEGORY_COLORS).flat(), '#9aa0a6'] as unknown as ExpressionSpecification;

    map.addLayer({
      id: 'track',
      type: 'line',
      source: 'track',
      paint: { 'line-color': '#ffb13b', 'line-width': 1.6, 'line-opacity': 0.85, 'line-dasharray': [2, 2] },
    });
    map.addLayer({
      id: 'me',
      type: 'circle',
      source: 'me',
      paint: {
        'circle-radius': 5,
        'circle-color': '#ffb13b',
        'circle-stroke-color': 'rgba(255,177,59,0.35)',
        'circle-stroke-width': 7,
      },
    });
    map.addLayer({
      id: 'sats',
      type: 'symbol',
      source: 'sats',
      layout: {
        'icon-image': 'sat',
        // Indian satellites and space stations are what people look for: draw them larger.
        'icon-size': ['interpolate', ['linear'], ['zoom'], 2, ['*', 0.5, EMPHASIS], 4, ['*', 0.8, EMPHASIS], 7, ['*', 1.15, EMPHASIS]],
        'icon-rotate': ['get', 'hdg'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: {
        'icon-color': color,
        // Satellites in Earth's shadow are invisible to the eye; show them dimmer.
        'icon-opacity': ['case', ['==', ['get', 'lit'], 1], 1, 0.6],
      },
    });
    map.addLayer({
      id: 'sat-labels',
      type: 'symbol',
      source: 'sats',
      minzoom: 3,
      filter: ['in', ['get', 'cat'], ['literal', LABELLED]],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: { 'text-color': color, 'text-halo-color': 'rgba(8,9,11,0.9)', 'text-halo-width': 1.4 },
    });
    map.addLayer({
      id: 'selected-halo',
      type: 'circle',
      source: 'selected',
      paint: {
        'circle-radius': 15,
        'circle-color': 'rgba(255,177,59,0.12)',
        'circle-stroke-color': '#ffb13b',
        'circle-stroke-width': 1.6,
      },
    });

    map.on('click', (e: MapMouseEvent) => this.events.onSelect(this.satAt(e)));
    map.on('mousemove', (e: MapMouseEvent) => {
      const sat = this.satAt(e);
      map.getCanvas().style.cursor = sat ? 'pointer' : '';
      this.events.onHover(sat, e.originalEvent.clientX, e.originalEvent.clientY);
    });
    map.on('mouseout', () => this.events.onHover(null, 0, 0));

    this.ready = true;
    this.push();
    this.drawObserver();
    // A deep-linked satellite may have been selected before the style finished loading.
    this.drawSelection();
  }

  /** Nearest satellite icon under the pointer, with a few pixels of slack for small icons. */
  private satAt(e: MapMouseEvent): Sat | null {
    const pad = matchMedia('(pointer: coarse)').matches ? 14 : 6;
    const { x, y } = e.point;
    const hits = this.map.queryRenderedFeatures(
      [
        [x - pad, y - pad],
        [x + pad, y + pad],
      ],
      { layers: ['sats'] },
    );
    if (!hits.length) return null;
    const i = this.sats.findIndex((s) => s.norad === hits[0].properties.norad);
    return i >= 0 ? this.sats[i] : null;
  }

  setSatellites(sats: Sat[]) {
    this.sats = sats;
    this.index = new Map(sats.map((s, i) => [s, i]));
    const n = sats.length;
    this.lat = new Float32Array(n);
    this.lon = new Float32Array(n);
    this.heading = new Float32Array(n);
    this.lit = new Uint8Array(n).fill(1);
    this.shown = new Uint8Array(n).fill(1);
    // Two passes 10 s apart give every satellite a direction of travel from the start.
    this.propagate(0, n, new Date(Date.now() - 10_000));
    this.propagate(0, n, new Date());
    this.push();
  }

  setFilter(show: (s: Sat) => boolean) {
    this.sats.forEach((s, i) => (this.shown[i] = show(s) ? 1 : 0));
    this.push();
  }

  setObserver(lat: number, lon: number) {
    this.observer = [lon, lat];
    this.drawObserver();
  }

  private drawObserver() {
    if (!this.ready || !this.observer) return;
    (this.map.getSource('me') as GeoJSONSource).setData({ type: 'Point', coordinates: this.observer });
  }

  select(sat: Sat | null, fly = false) {
    this.selected = sat;
    this.drawSelection();
    if (sat && fly) {
      const i = this.index.get(sat)!;
      this.map.flyTo({ center: [this.lon[i], this.lat[i]], zoom: Math.max(this.map.getZoom(), 4.2), speed: 1.4 });
    }
  }

  private drawSelection() {
    if (!this.ready) return;
    const sat = this.selected;
    const i = sat ? this.index.get(sat) : undefined;
    (this.map.getSource('selected') as GeoJSONSource).setData(
      i === undefined ? { type: 'FeatureCollection', features: [] } : { type: 'Point', coordinates: [this.lon[i], this.lat[i]] },
    );
    (this.map.getSource('track') as GeoJSONSource).setData(sat ? groundTrack(sat, new Date()) : { type: 'FeatureCollection', features: [] });
  }

  follow(sat: Sat | null) {
    this.following = sat;
    if (sat) this.push();
  }

  flyToLatLon(lat: number, lon: number) {
    this.following = null;
    this.map.flyTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), 5), speed: 1.4 });
  }

  /** Back to the default view of India. */
  home() {
    this.following = null;
    this.map.fitBounds(INDIA_BOX, { padding: fitPadding(), speed: 1.4 });
  }

  toggleProjection(): Projection {
    this.projection = this.projection === 'mercator' ? 'globe' : 'mercator';
    this.map.setProjection({ type: this.projection });
    if (this.projection === 'globe') this.map.easeTo({ zoom: Math.min(this.map.getZoom(), 2.2), duration: 800 });
    return this.projection;
  }

  /** Geocentric latitude/longitude from the last propagation (a few frames old). */
  approxLatLon(i: number): [lat: number, lon: number] {
    return [this.lat[i], this.lon[i]];
  }

  isShown(i: number): boolean {
    return this.shown[i] === 1;
  }

  private propagateChunk() {
    if (!this.sats.length) return;
    this.propagate(this.cursor, this.budget, new Date());
    this.cursor = (this.cursor + this.budget) % this.sats.length;
  }

  private propagate(from: number, count: number, now: Date) {
    const gmst = gstime(now);
    const sun = sunPos(jday(now)).rsun;
    const end = Math.min(from + count, this.sats.length);
    for (let i = from; i < end; i++) {
      const eci = satEci(this.sats[i].satrec, now);
      if (!eci) {
        this.shown[i] = 0;
        continue;
      }
      const ecf = eciToEcf(eci, gmst);
      const lat = (Math.atan2(ecf.z, Math.hypot(ecf.x, ecf.y)) * 180) / Math.PI;
      const lon = (Math.atan2(ecf.y, ecf.x) * 180) / Math.PI;
      const pLat = this.lat[i];
      const pLon = this.lon[i];
      if (pLat || pLon) this.heading[i] = bearing(pLat, pLon, lat, lon);
      this.lat[i] = lat;
      this.lon[i] = lon;
      this.lit[i] = shadowFraction(sun, eci) < 0.5 ? 1 : 0;
    }
  }

  /**
   * Send the satellites over India to the map: the same set as the "Over India" list.
   * The selected satellite is always included, so it does not vanish when it leaves India.
   */
  private push() {
    if (!this.ready || !this.sats.length) return;
    const features: GeoJSON.Feature[] = [];
    for (let i = 0; i < this.sats.length; i++) {
      const s = this.sats[i];
      const lat = this.lat[i];
      const lon = this.lon[i];
      if (s !== this.selected && (!this.shown[i] || !isOverIndia(lat, lon))) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { norad: s.norad, cat: s.category, name: s.name, hdg: this.heading[i], lit: this.lit[i], rank: rank(s.category) },
      });
    }
    (this.map.getSource('sats') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
    this.drawSelectionPoint();

    if (this.following) {
      const i = this.index.get(this.following);
      if (i !== undefined) this.map.easeTo({ center: [this.lon[i], this.lat[i]], duration: 1000, easing: (t: number) => t });
    }
  }

  private drawSelectionPoint() {
    const i = this.selected ? this.index.get(this.selected) : undefined;
    if (i === undefined) return;
    (this.map.getSource('selected') as GeoJSONSource).setData({ type: 'Point', coordinates: [this.lon[i], this.lat[i]] });
  }
}

/** Draw order: important satellites on top of the Starlink swarm. */
function rank(c: Category) {
  return { starlink: 0, oneweb: 1, other: 2, gnss: 3, weather: 4, india: 5, station: 6 }[c];
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const dLon = (lon2 - lon1) * r;
  const y = Math.sin(dLon) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dLon);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

/**
 * Ground track for half an orbit back and one orbit ahead, split where it crosses the
 * antimeridian so MapLibre does not draw a line across the whole map.
 */
export function groundTrack(sat: Sat, now: Date): GeoJSON.Feature<GeoJSON.MultiLineString> {
  const periodMs = Math.min(periodMinutes(sat), 24 * 60) * 60_000;
  const steps = 240;
  const lines: number[][][] = [[]];
  let prevLon: number | null = null;
  for (let k = 0; k <= steps; k++) {
    const t = new Date(now.getTime() - periodMs / 2 + (k / steps) * periodMs * 1.5);
    const eci = satEci(sat.satrec, t);
    if (!eci) continue;
    const g = eciToGeodetic(eci, gstime(t));
    const lat = degreesLat(g.latitude);
    const lon = degreesLong(g.longitude);
    if (prevLon !== null && Math.abs(lon - prevLon) > 180) lines.push([]);
    lines[lines.length - 1].push([lon, lat]);
    prevLon = lon;
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines.filter((l) => l.length > 1) } };
}

/** A small satellite glyph (body + two solar panels), drawn once as an SDF so it can be tinted. */
function satelliteIcon(): ImageData {
  const size = 48;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.translate(size / 2, size / 2);
  g.fillRect(-5, -7, 10, 14); // body, long axis along the direction of travel
  g.fillRect(-21, -4, 13, 8); // left panel
  g.fillRect(8, -4, 13, 8); // right panel
  g.fillRect(-8, -1, 3, 2);
  g.fillRect(5, -1, 3, 2);
  g.beginPath();
  g.moveTo(-3, -7);
  g.lineTo(0, -12);
  g.lineTo(3, -7);
  g.fill(); // nose shows which way it is heading
  return g.getImageData(0, 0, size, size);
}
