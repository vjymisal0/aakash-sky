// "Over India" test for satellite ground points. The outline is a coarse hand-drawn
// polygon (about 25-50 km accuracy) that follows India's official boundary, plus boxes
// for the Andaman & Nicobar and Lakshadweep islands. It is for grouping, not mapping,
// and is never drawn on screen.
import { degreesLat, degreesLong, eciToGeodetic, gstime, type SatRec } from 'satellite.js';
import { satEci } from './sky';

type Ring = Array<[lon: number, lat: number]>;

const MAINLAND: Ring = [
  [68.2, 23.7], [68.8, 24.3], [70.0, 24.3], [71.1, 24.4], [70.6, 25.7], [70.1, 26.6],
  [69.5, 27.0], [70.4, 28.0], [71.9, 27.9], [73.0, 29.2], [73.9, 30.0], [74.5, 30.9],
  [74.6, 31.9], [75.3, 32.3], [74.0, 32.9], [73.5, 33.6], [73.7, 34.6], [72.6, 35.6],
  [73.6, 36.4], [74.8, 37.1], [76.0, 36.9], [77.8, 35.6], [80.2, 35.6], [80.3, 35.0],
  [79.5, 34.3], [78.9, 33.0], [79.5, 32.5], [78.8, 31.6], [79.0, 31.1], [80.2, 30.6],
  [80.9, 30.2], [80.1, 29.7], [80.1, 28.8], [81.2, 28.3], [83.3, 27.4], [84.6, 27.3],
  [85.9, 26.6], [87.0, 26.4], [88.1, 26.4], [88.0, 27.1], [88.1, 27.9], [88.8, 28.0],
  [88.9, 27.3], [89.8, 26.7], [91.6, 26.8], [92.1, 26.9], [91.6, 27.8], [92.5, 27.9],
  [93.3, 28.6], [94.5, 29.2], [95.4, 29.0], [96.2, 29.4], [97.4, 28.3], [96.6, 27.3],
  [95.2, 26.6], [94.6, 25.5], [94.2, 24.0], [93.4, 23.0], [93.2, 22.2], [92.6, 21.9],
  [92.3, 23.2], [92.0, 24.2], [91.2, 23.6], [91.6, 25.0], [90.0, 25.2], [89.8, 26.0],
  [88.6, 26.2], [88.1, 25.4], [88.6, 24.3], [88.9, 22.6], [89.0, 21.6], [87.0, 21.5],
  [86.0, 20.0], [85.0, 19.3], [84.0, 18.2], [82.3, 16.6], [81.0, 15.7], [80.2, 15.0],
  [80.45, 13.3], [80.0, 11.5], [80.0, 10.3], [79.4, 9.2], [78.3, 8.7], [77.55, 7.9],
  [76.4, 8.9], [76.0, 10.5], [75.6, 11.8], [74.8, 12.8], [74.4, 14.5], [73.6, 16.0],
  [73.0, 18.0], [72.7, 19.0], [72.7, 20.5], [72.6, 21.4], [72.5, 22.2], [72.1, 21.3],
  [71.0, 20.7], [70.0, 21.0], [69.0, 22.3], [69.4, 22.8], [68.5, 23.0],
];

const ISLANDS: Array<[minLon: number, minLat: number, maxLon: number, maxLat: number]> = [
  [92.2, 6.7, 93.95, 13.7], // Andaman & Nicobar
  [71.7, 8.0, 74.0, 12.4], // Lakshadweep
];

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
  if (lat < 6.5 || lat > 37.2 || lon < 68 || lon > 97.5) return false;
  if (ISLANDS.some(([a, b, c, d]) => lon >= a && lon <= c && lat >= b && lat <= d)) return true;
  return inRing(lon, lat, MAINLAND);
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
