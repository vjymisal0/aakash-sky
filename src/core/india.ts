// "Over India" test for satellite ground points, using India's outline as India officially
// draws it (Natural Earth 1:10m, India point of view, simplified to ~2 km by
// scripts/build-india.mjs). The same outline frames the map.
import { degreesLat, degreesLong, eciToGeodetic, gstime, type SatRec } from 'satellite.js';
import outline from '../data/india.json';
import { satEci } from './sky';

type Ring = number[][];

export const INDIA_OUTLINE = outline as GeoJSON.Feature<GeoJSON.MultiPolygon>;

// Outer rings only (Natural Earth India has no holes), each with its own bounding box.
const POLYGONS = INDIA_OUTLINE.geometry.coordinates.map((poly) => {
  const ring = poly[0] as Ring;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { ring, minX, minY, maxX, maxY };
});

/** Bounding box of all of India, islands included. */
export const INDIA_BOUNDS = {
  west: Math.min(...POLYGONS.map((p) => p.minX)),
  south: Math.min(...POLYGONS.map((p) => p.minY)),
  east: Math.max(...POLYGONS.map((p) => p.maxX)),
  north: Math.max(...POLYGONS.map((p) => p.maxY)),
};

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function isOverIndia(lat: number, lon: number): boolean {
  // Cheap bounding box first: almost every satellite is far away.
  const b = INDIA_BOUNDS;
  if (lat < b.south || lat > b.north || lon < b.west || lon > b.east) return false;
  return POLYGONS.some((p) => lon >= p.minX && lon <= p.maxX && lat >= p.minY && lat <= p.maxY && inRing(lon, lat, p.ring));
}

export function subPoint(satrec: SatRec, date: Date) {
  const eci = satEci(satrec, date);
  if (!eci) return null;
  const g = eciToGeodetic(eci, gstime(date));
  return { lat: degreesLat(g.latitude), lon: degreesLong(g.longitude), heightKm: g.height };
}

export interface Crossing {
  /** When the ground point entered India (or the search limit if it has been over India longer). */
  entered: Date;
  /** When it will leave, or null for satellites that stay (geostationary-like). */
  leaves: Date | null;
}

/**
 * Walk the ground track backwards and forwards to find this crossing's entry and exit.
 * A LEO satellite crosses India in about 2 to 8 minutes, so a 20 s step and 30 min limit are plenty.
 */
export function crossing(satrec: SatRec, now: Date, stepSec = 20, limitMin = 30): Crossing {
  const step = stepSec * 1000;
  const limit = limitMin * 60_000;
  const over = (t: number) => {
    const p = subPoint(satrec, new Date(t));
    return !!p && isOverIndia(p.lat, p.lon);
  };
  const t0 = now.getTime();
  let entered = t0;
  while (t0 - entered < limit && over(entered - step)) entered -= step;
  let leaves: number | null = t0;
  while (over(leaves + step)) {
    leaves += step;
    if (leaves - t0 >= limit) {
      leaves = null;
      break;
    }
  }
  return { entered: new Date(entered), leaves: leaves === null ? null : new Date(leaves) };
}
