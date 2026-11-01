// Observer-centric astronomy: where a satellite is in your sky, whether you can see it,
// and when it will next pass over. Everything here is pure and runs in a worker or tests.
import {
  degreesToRadians,
  ecfToLookAngles,
  eciToEcf,
  gstime,
  jday,
  propagate,
  radiansToDegrees,
  shadowFraction,
  sunPos,
  type EciVec3,
  type GeodeticLocation,
  type SatRec,
} from 'satellite.js';

const KM_PER_AU = 149_597_870.7;

export interface Observer {
  /** Degrees, north positive. */
  lat: number;
  /** Degrees, east positive. */
  lon: number;
  heightKm?: number;
}

export interface Look {
  azimuth: number;
  elevation: number;
  rangeKm: number;
}

/** Sun must be this far below the horizon for the sky to be dark enough (civil twilight). */
export const DARK_SUN_ELEVATION = -6;
export const MIN_ELEVATION = 10;

function geodetic(o: Observer): GeodeticLocation {
  return {
    latitude: degreesToRadians(o.lat),
    longitude: degreesToRadians(o.lon),
    height: o.heightKm ?? 0,
  };
}

export function sunEciKm(date: Date): EciVec3<number> {
  const { rsun } = sunPos(jday(date));
  return { x: rsun.x * KM_PER_AU, y: rsun.y * KM_PER_AU, z: rsun.z * KM_PER_AU };
}

export function sunElevation(o: Observer, date: Date): number {
  const ecf = eciToEcf(sunEciKm(date), gstime(date));
  return radiansToDegrees(ecfToLookAngles(geodetic(o), ecf).elevation);
}

export function satEci(satrec: SatRec, date: Date): EciVec3<number> | null {
  const pv = propagate(satrec, date);
  return pv && Number.isFinite(pv.position.x) ? pv.position : null;
}

export function lookAt(o: Observer, eci: EciVec3<number>, date: Date): Look {
  const look = ecfToLookAngles(geodetic(o), eciToEcf(eci, gstime(date)));
  return {
    azimuth: radiansToDegrees(look.azimuth),
    elevation: radiansToDegrees(look.elevation),
    rangeKm: look.rangeSat,
  };
}

/** True when the satellite is in sunlight (less than half the Sun's disc hidden by Earth). */
export function isSunlit(eci: EciVec3<number>, date: Date): boolean {
  return shadowFraction(sunPos(jday(date)).rsun, eci) < 0.5;
}

export interface PassPoint {
  time: Date;
  azimuth: number;
  elevation: number;
}

/** The naked-eye-visible part of one overhead pass. */
export interface Pass {
  norad: number;
  start: PassPoint;
  max: PassPoint;
  end: PassPoint;
}

export interface PassOptions {
  minElevation?: number;
  /** Coarse scan step. LEO passes above 10° last several minutes, so 60 s cannot skip one. */
  coarseStepSec?: number;
  fineStepSec?: number;
  /** When false, return every pass above `minElevation` regardless of light. Used for tests. */
  requireVisible?: boolean;
}

/**
 * Time ranges in [from, to) when the sky at the observer is dark enough to see satellites.
 * Computed once and shared across every satellite, which skips most daytime work.
 */
export function darkWindows(o: Observer, from: Date, to: Date, stepSec = 120): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let open: number | null = null;
  for (let t = from.getTime(); t < to.getTime(); t += stepSec * 1000) {
    const dark = sunElevation(o, new Date(t)) < DARK_SUN_ELEVATION;
    if (dark && open === null) open = t;
    if (!dark && open !== null) {
      out.push([open, t]);
      open = null;
    }
  }
  if (open !== null) out.push([open, to.getTime()]);
  return out;
}

/**
 * Find visible passes: satellite above `minElevation`, observer in darkness, satellite sunlit.
 * A pass that dips into Earth's shadow mid-way yields only its sunlit segment.
 */
export function findVisiblePasses(
  satrec: SatRec,
  norad: number,
  o: Observer,
  windows: Array<[number, number]>,
  opts: PassOptions = {},
): Pass[] {
  const minEl = opts.minElevation ?? MIN_ELEVATION;
  const coarse = (opts.coarseStepSec ?? 60) * 1000;
  const fine = (opts.fineStepSec ?? 5) * 1000;
  const requireVisible = opts.requireVisible ?? true;
  const passes: Pass[] = [];

  const elevationAt = (t: number): number | null => {
    const d = new Date(t);
    const eci = satEci(satrec, d);
    return eci ? lookAt(o, eci, d).elevation : null;
  };

  for (const [winStart, winEnd] of windows) {
    let t = winStart;
    while (t < winEnd) {
      const el = elevationAt(t);
      if (el === null) return passes; // decayed or invalid elements
      if (el <= 0) {
        t += coarse;
        continue;
      }
      // Above the horizon: walk the whole pass at fine resolution.
      let segment: PassPoint[] = [];
      let ft = Math.max(winStart, t - coarse);
      for (; ft < winEnd; ft += fine) {
        const d = new Date(ft);
        const eci = satEci(satrec, d);
        if (!eci) break;
        const look = lookAt(o, eci, d);
        if (look.elevation <= 0 && ft > t) break;
        const visible =
          look.elevation >= minEl &&
          (!requireVisible || (isSunlit(eci, d) && sunElevation(o, d) < DARK_SUN_ELEVATION));
        if (visible) {
          segment.push({ time: d, azimuth: look.azimuth, elevation: look.elevation });
        } else if (segment.length) {
          pushPass(passes, norad, segment);
          segment = [];
        }
      }
      if (segment.length) pushPass(passes, norad, segment);
      t = ft + coarse;
    }
  }
  return passes;
}

function pushPass(passes: Pass[], norad: number, seg: PassPoint[]) {
  // Ignore blips shorter than ~10 s; nobody can step outside for those.
  if (seg.length < 3) return;
  const max = seg.reduce((a, b) => (b.elevation > a.elevation ? b : a));
  passes.push({ norad, start: seg[0], max, end: seg[seg.length - 1] });
}

/**
 * Merge passes of objects that fly together, such as modules and spacecraft docked to the ISS:
 * they cross the sky at the same moment along the same path, so they are one sight, not several.
 * `prefer` picks which satellite names the merged pass. Input and output are sorted by start.
 */
export function dedupePasses(passes: Pass[], prefer: (norad: number) => boolean, toleranceSec = 30): Pass[] {
  const sorted = [...passes].sort((a, b) => a.start.time.getTime() - b.start.time.getTime());
  const out: Pass[] = [];
  const tol = toleranceSec * 1000;
  const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  const same = (a: Pass, b: Pass) =>
    Math.abs(a.max.time.getTime() - b.max.time.getTime()) <= tol &&
    Math.abs(a.max.elevation - b.max.elevation) <= 2 &&
    angle(a.max.azimuth, b.max.azimuth) <= 5;
  for (const p of sorted) {
    let i = out.length - 1;
    while (i >= 0 && p.start.time.getTime() - out[i].start.time.getTime() <= tol && !same(out[i], p)) i--;
    const dup = i >= 0 && p.start.time.getTime() - out[i].start.time.getTime() <= tol;
    if (!dup) out.push(p);
    else if (prefer(p.norad) && !prefer(out[i].norad)) out[i] = p;
  }
  return out;
}
