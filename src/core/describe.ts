// Human-facing descriptions derived from catalog fields. No invented data: anything we
// cannot derive from the name, owner code or orbit is left out.
import type { Sat } from './catalog';

export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'] as const;
export type CompassPoint = (typeof COMPASS)[number];

export function compass(azimuthDeg: number): CompassPoint {
  const a = ((azimuthDeg % 360) + 360) % 360;
  return COMPASS[Math.round(a / 22.5) % 16];
}

export type Mission =
  | 'navigation'
  | 'earthObservation'
  | 'radar'
  | 'communication'
  | 'weather'
  | 'ocean'
  | 'science'
  | 'student'
  | 'crewed'
  | 'internet';

// Indian satellite families by name. Order matters: the first match wins.
const INDIA_FAMILIES: Array<[RegExp, Mission]> = [
  [/IRNSS|NVS-/, 'navigation'],
  [/RISAT|EOS-0?4\b|NISAR/, 'radar'],
  [/OCEANSAT|EOS-06|SCATSAT|SARAL/, 'ocean'],
  [/INSAT-3D|KALPANA|METSAT/, 'weather'],
  [/CARTOSAT|RESOURCESAT|IRS-|EOS-|HYSIS|GISAT/, 'earthObservation'],
  [/GSAT|INSAT|CMS-|EDUSAT/, 'communication'],
  [/ASTROSAT|XPOSAT|ADITYA/, 'science'],
  [/STUDSAT|JUGNU|SRMSAT|PRATHAM|PISAT|YOUTHSAT/, 'student'],
];

export function mission(sat: Pick<Sat, 'name' | 'category'>): Mission | null {
  if (sat.category === 'station') return 'crewed';
  if (sat.category === 'gnss') return 'navigation';
  if (sat.category === 'weather') return 'weather';
  if (sat.category === 'starlink' || sat.category === 'oneweb') return 'internet';
  if (sat.category === 'india') {
    for (const [re, m] of INDIA_FAMILIES) if (re.test(sat.name)) return m;
  }
  return null;
}

/** Owner codes as used in the CelesTrak SATCAT. Unknown codes are shown as-is. */
export const OWNERS: Record<string, string> = {
  IND: 'India',
  US: 'United States',
  PRC: 'China',
  CIS: 'Russia / former USSR',
  ESA: 'European Space Agency',
  JPN: 'Japan',
  UK: 'United Kingdom',
  FR: 'France',
  GER: 'Germany',
  ISS: 'International Space Station partners',
  CA: 'Canada',
  KOR: 'South Korea',
  ISRA: 'Israel',
  UAE: 'United Arab Emirates',
  EUME: 'EUMETSAT',
  SES: 'SES',
  GLOB: 'Globalstar',
  ORB: 'ORBCOMM',
  IRID: 'Iridium',
  AB: 'Arab Satellite Communications Organization',
  ITSO: 'Intelsat',
  EUTE: 'Eutelsat',
  BRAZ: 'Brazil',
  AUS: 'Australia',
  IT: 'Italy',
  SPN: 'Spain',
  TURK: 'Turkey',
  INDO: 'Indonesia',
  TWN: 'Taiwan',
  ARGN: 'Argentina',
  SAFR: 'South Africa',
  O3B: 'O3b',
  NETH: 'Netherlands',
  FIN: 'Finland',
  LUXE: 'Luxembourg',
};

export type OrbitClass = 'LEO' | 'MEO' | 'GEO' | 'HEO';

export function orbitClass(meanMotion: number, eccentricity = 0): OrbitClass {
  if (eccentricity > 0.25) return 'HEO';
  if (meanMotion > 11.25) return 'LEO';
  if (meanMotion > 0.9 && meanMotion < 1.1) return 'GEO';
  return 'MEO';
}
