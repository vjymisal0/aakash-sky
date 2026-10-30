import { json2satrec, type SatRec } from 'satellite.js';

export type Category = 'station' | 'india' | 'gnss' | 'weather' | 'starlink' | 'oneweb' | 'other';

/** Positional record as written by scripts/lib/catalog.mjs. */
export type RawSat = [
  name: string,
  norad: number,
  objectId: string,
  epoch: string,
  meanMotion: number,
  eccentricity: number,
  inclination: number,
  raan: number,
  argPericenter: number,
  meanAnomaly: number,
  bstar: number,
  meanMotionDot: number,
  meanMotionDdot: number,
  category: Category,
  owner: string,
  launchDate: string,
  flags: number,
];

export interface RawCatalog {
  generatedAt: string;
  source: string;
  fields: string[];
  sats: RawSat[];
}

export interface Sat {
  name: string;
  norad: number;
  objectId: string;
  epoch: string;
  /** Revolutions per day. */
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  category: Category;
  owner: string;
  launchDate: string;
  /** Bright enough to see with the naked eye (CelesTrak "visual" or a space station). */
  visual: boolean;
  satrec: SatRec;
}

const FLAG_VISUAL = 1;

export function toOmm(r: RawSat) {
  return {
    OBJECT_NAME: r[0],
    NORAD_CAT_ID: r[1],
    OBJECT_ID: r[2],
    EPOCH: r[3],
    MEAN_MOTION: r[4],
    ECCENTRICITY: r[5],
    INCLINATION: r[6],
    RA_OF_ASC_NODE: r[7],
    ARG_OF_PERICENTER: r[8],
    MEAN_ANOMALY: r[9],
    BSTAR: r[10],
    MEAN_MOTION_DOT: r[11],
    MEAN_MOTION_DDOT: r[12],
    ELEMENT_SET_NO: 999,
  };
}

export function decodeSat(r: RawSat): Sat {
  return {
    name: r[0],
    norad: r[1],
    objectId: r[2],
    epoch: r[3],
    meanMotion: r[4],
    eccentricity: r[5],
    inclination: r[6],
    category: r[13],
    owner: r[14],
    launchDate: r[15],
    visual: (r[16] & FLAG_VISUAL) !== 0,
    satrec: json2satrec(toOmm(r)),
  };
}

/** Orbital period in minutes. */
export function periodMinutes(sat: Pick<Sat, 'meanMotion'>): number {
  return 1440 / sat.meanMotion;
}
