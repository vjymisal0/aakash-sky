import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script without type declarations
import { buildCatalog, categorize, parseCsv } from '../scripts/lib/catalog.mjs';
import { decodeSat, type RawSat } from '../src/core/catalog';
import { satEci } from '../src/core/sky';

const GP_HEADER =
  'OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT';
const ISS = 'ISS (ZARYA),1998-067A,2026-10-29T13:31:42.192192,15.49100842,.00070497,51.6333,355.1294,324.3141,35.7375,0,U,25544,999,59258,.10764701E-3,.5507E-4,0';
const CARTOSAT = 'CARTOSAT-3,2019-081A,2026-10-29T10:00:00.000000,15.19,.0012,97.4,10,20,30,0,U,44804,999,100,.1E-4,.1E-5,0';
// Six-digit catalog numbers exist since 2026 and cannot be written in classic TLE format.
const AAGAMAN = 'AAGAMAN OBJECT A,2026-150A,2026-10-29T10:00:00.000000,15.0,.001,45,10,20,30,0,U,100080,999,100,.1E-4,.1E-5,0';
const SATCAT_HEADER = 'OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,LAUNCH_DATE';

describe('parseCsv', () => {
  it('handles quoted fields with commas, escaped quotes and CRLF', () => {
    const rows = parseCsv('A,B\r\n"x, y","say ""hi"""\r\n1,2\r\n');
    expect(rows).toEqual([
      { A: 'x, y', B: 'say "hi"' },
      { A: '1', B: '2' },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('categorize', () => {
  const empty = { stations: new Set(), gnss: new Set(), weather: new Set() };
  it('prefers India over GNSS so NavIC counts as Indian', () => {
    const groups = { ...empty, gnss: new Set([62850]) };
    expect(categorize({ name: 'NVS-02 (IRNSS-1K)', norad: 62850, owner: 'IND', groups })).toBe('india');
  });
  it('detects constellations by name', () => {
    expect(categorize({ name: 'STARLINK-1007', norad: 1, owner: 'US', groups: empty })).toBe('starlink');
    expect(categorize({ name: 'ONEWEB-0012', norad: 2, owner: 'UK', groups: empty })).toBe('oneweb');
    expect(categorize({ name: 'SOMETHING', norad: 3, owner: 'US', groups: empty })).toBe('other');
  });
  // CelesTrak's "stations" group also lists cubesats released from the ISS.
  it('treats only stations, their modules and visiting spacecraft as stations', () => {
    const ids = [25544, 49044, 48274, 64001, 64002, 64003, 64004];
    const groups = { ...empty, stations: new Set(ids) };
    const cat = (name: string, norad: number, owner = 'US') => categorize({ name, norad, owner, groups });
    expect(cat('ISS (ZARYA)', 25544, 'ISS')).toBe('station');
    expect(cat('ISS (NAUKA)', 49044, 'CIS')).toBe('station');
    expect(cat('CSS (TIANHE)', 48274, 'PRC')).toBe('station');
    expect(cat('PROGRESS-MS 34', 64001, 'CIS')).toBe('station');
    expect(cat('CREW DRAGON 13', 64002)).toBe('station');
    expect(cat('KNACKSAT-2', 64003, 'THAI')).toBe('other');
    expect(cat('HMU-SAT2', 64004, 'IND')).toBe('india');
  });
});

describe('buildCatalog', () => {
  const catalog = buildCatalog({
    activeCsv: [GP_HEADER, ISS, CARTOSAT, AAGAMAN].join('\n'),
    satcatCsv: [
      SATCAT_HEADER,
      'ISS (ZARYA),1998-067A,25544,PAY,+,ISS,1998-11-20',
      'CARTOSAT-3,2019-081A,44804,PAY,+,IND,2019-11-27',
      'AAGAMAN OBJECT A,2026-150A,100080,PAY,+,IND,2026-07-18',
    ].join('\n'),
    groupCsvs: {
      visual: `${GP_HEADER}\n${ISS}`,
      stations: `${GP_HEADER}\n${ISS}`,
      gnss: GP_HEADER,
      weather: GP_HEADER,
    },
    generatedAt: '2026-10-30T00:00:00.000Z',
  });

  it('joins owner, launch date, category and visibility flag', () => {
    const [iss, carto] = catalog.sats as RawSat[];
    expect(iss[13]).toBe('station');
    expect(iss[16]).toBe(1);
    expect(carto[13]).toBe('india');
    expect(carto[14]).toBe('IND');
    expect(carto[15]).toBe('2019-11-27');
    expect(carto[16]).toBe(0);
  });

  it('marks stations visible only through the visual group or as a main station', () => {
    const cube = 'KNACKSAT-2,2026-001X,2026-10-29T10:00:00.000000,15.5,.001,51.6,10,20,30,0,U,64003,999,100,.1E-4,.1E-5,0';
    const nauka = 'ISS (NAUKA),2021-066A,2026-10-29T13:31:42.192192,15.49100842,.00070497,51.6333,355.1294,324.3141,35.7375,0,U,49044,999,59258,.10764701E-3,.5507E-4,0';
    const c = buildCatalog({
      activeCsv: [GP_HEADER, ISS, nauka, cube].join('\n'),
      satcatCsv: SATCAT_HEADER,
      groupCsvs: { visual: GP_HEADER, stations: [GP_HEADER, ISS, nauka, cube].join('\n'), gnss: GP_HEADER, weather: GP_HEADER },
      generatedAt: '2026-10-30T00:00:00.000Z',
    });
    const flags = Object.fromEntries((c.sats as RawSat[]).map((r) => [r[0], r[16]]));
    // ISS stays visible even if the visual group download failed; its attached module and the cubesat do not.
    expect(flags).toEqual({ 'ISS (ZARYA)': 1, 'ISS (NAUKA)': 0, 'KNACKSAT-2': 0 });
  });

  it('produces records the client can decode and propagate, including 6-digit IDs', () => {
    for (const raw of catalog.sats as RawSat[]) {
      const sat = decodeSat(raw);
      const eci = satEci(sat.satrec, new Date('2026-10-30T00:00:00Z'));
      expect(eci).not.toBeNull();
      expect(Math.hypot(eci!.x, eci!.y, eci!.z)).toBeGreaterThan(6371);
    }
    expect(decodeSat(catalog.sats[2] as RawSat).norad).toBe(100080);
  });
});
