// One-off generator for src/data/india.json: India's outline as India officially draws it.
// Input: Natural Earth 1:10m "admin 0 countries, India point of view" (public domain), from
// https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson
// Usage: node scripts/build-india.mjs <path-to-geojson>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOLERANCE_DEG = 0.02; // ~2 km: invisible at country zoom, keeps the file small
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/india.json');

const src = process.argv[2];
if (!src) throw new Error('usage: node scripts/build-india.mjs <ne_10m_admin_0_countries_ind.geojson>');
const india = JSON.parse(readFileSync(src, 'utf8')).features.find((f) => f.properties.ADM0_A3 === 'IND');
if (!india) throw new Error('India (ADM0_A3=IND) not found');

/** Ramer–Douglas–Peucker on a closed ring. */
function simplify(points, tol) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A closed ring starts and ends on the same point, so split it at the farthest vertex first. */
function simplifyRing(ring, tol) {
  const [x0, y0] = ring[0];
  let far = 1;
  for (let i = 1; i < ring.length; i++) {
    if (Math.hypot(ring[i][0] - x0, ring[i][1] - y0) > Math.hypot(ring[far][0] - x0, ring[far][1] - y0)) far = i;
  }
  return [...simplify(ring.slice(0, far + 1), tol), ...simplify(ring.slice(far), tol).slice(1)];
}

const round = ([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
const polys = india.geometry.type === 'Polygon' ? [india.geometry.coordinates] : india.geometry.coordinates;
const simplified = polys
  .map((rings) => rings.map((r) => simplifyRing(r, TOLERANCE_DEG).map(round)).filter((r) => r.length >= 4))
  .filter((rings) => rings.length);

const feature = {
  type: 'Feature',
  properties: { name: 'India', source: 'Natural Earth 1:10m admin-0, India point of view (public domain)' },
  geometry: { type: 'MultiPolygon', coordinates: simplified },
};
writeFileSync(out, JSON.stringify(feature));
const pts = simplified.flat(2).length;
console.log(`Wrote ${simplified.length} polygons, ${pts} points to ${out}`);
