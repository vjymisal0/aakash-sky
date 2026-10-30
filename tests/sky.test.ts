import { describe, expect, it } from 'vitest';
import { json2satrec } from 'satellite.js';
import { darkWindows, findVisiblePasses, sunElevation, type Observer } from '../src/core/sky';

// ISS elements from CelesTrak, epoch 2026-10-29. Reference values below were computed
// independently with Skyfield 1.55 + DE421 (find_events at 10°, is_sunlit, apparent sun altitude).
const iss = json2satrec({
  OBJECT_NAME: 'ISS (ZARYA)',
  OBJECT_ID: '1998-067A',
  EPOCH: '2026-10-29T13:31:42.192192',
  MEAN_MOTION: 15.49100842,
  ECCENTRICITY: 0.00070497,
  INCLINATION: 51.6333,
  RA_OF_ASC_NODE: 355.1294,
  ARG_OF_PERICENTER: 324.3141,
  MEAN_ANOMALY: 35.7375,
  NORAD_CAT_ID: 25544,
  ELEMENT_SET_NO: 999,
  BSTAR: 0.00010764701,
  MEAN_MOTION_DOT: 0.00005507,
  MEAN_MOTION_DDOT: 0,
});

const delhi: Observer = { lat: 28.6139, lon: 77.209 };
const sydney: Observer = { lat: -33.8688, lon: 151.2093 };
const tokyo: Observer = { lat: 35.6762, lon: 139.6503 };

const from = new Date('2026-10-30T00:00:00Z');
const to = new Date('2026-11-02T00:00:00Z');
const allDay: Array<[number, number]> = [[from.getTime(), to.getTime()]];

const secondsApart = (a: Date, iso: string) => Math.abs(a.getTime() - Date.parse(iso)) / 1000;

describe('sunElevation', () => {
  it('matches Skyfield within 0.3°', () => {
    expect(sunElevation(delhi, new Date('2026-10-30T00:55:43Z'))).toBeCloseTo(-2.1, 0);
    expect(Math.abs(sunElevation(delhi, new Date('2026-10-30T17:34:16Z')) - -69.7)).toBeLessThan(0.3);
    expect(Math.abs(sunElevation(delhi, new Date('2026-10-30T02:32:37Z')) - 17.8)).toBeLessThan(0.3);
  });
});

describe('findVisiblePasses geometry', () => {
  const passes = findVisiblePasses(iss, 25544, delhi, allDay, { requireVisible: false });
  // Skyfield: Delhi passes above 10° between 2026-10-30 and 2026-11-02.
  const reference = [
    ['2026-10-30T00:53:41Z', '2026-10-30T00:55:43Z', '2026-10-30T00:57:45Z', 14.9],
    ['2026-10-30T02:29:27Z', '2026-10-30T02:32:37Z', '2026-10-30T02:35:48Z', 38.2],
    ['2026-10-30T17:31:01Z', '2026-10-30T17:34:16Z', '2026-10-30T17:37:32Z', 48.4],
    ['2026-10-31T01:41:45Z', '2026-10-31T01:45:09Z', '2026-10-31T01:48:31Z', 83.5],
    ['2026-10-31T16:43:24Z', '2026-10-31T16:46:43Z', '2026-10-31T16:50:04Z', 78.9],
    ['2026-11-01T00:54:18Z', '2026-11-01T00:57:35Z', '2026-11-01T01:00:52Z', 46.3],
    ['2026-11-01T15:56:09Z', '2026-11-01T15:59:14Z', '2026-11-01T16:02:20Z', 35.8],
    ['2026-11-01T17:34:03Z', '2026-11-01T17:36:07Z', '2026-11-01T17:38:11Z', 15.2],
  ] as const;

  it('finds the same passes as Skyfield', () => {
    expect(passes).toHaveLength(reference.length);
  });

  it.each(reference.map((r, i) => [i, ...r] as const))(
    'pass %i: rise/max/set within 10 s, max elevation within 0.5°',
    (i, rise, max, set, maxEl) => {
      const p = passes[i];
      expect(secondsApart(p.start.time, rise)).toBeLessThanOrEqual(10);
      expect(secondsApart(p.max.time, max)).toBeLessThanOrEqual(10);
      expect(secondsApart(p.end.time, set)).toBeLessThanOrEqual(10);
      expect(Math.abs(p.max.elevation - maxEl)).toBeLessThan(0.5);
    },
  );
});

describe('findVisiblePasses visibility', () => {
  it('rejects Delhi passes that are in twilight or in Earth shadow', () => {
    // Skyfield: morning passes have the sun at about -2° (too bright), evening ones are unlit.
    expect(findVisiblePasses(iss, 25544, delhi, darkWindows(delhi, from, to))).toEqual([]);
  });

  it('finds the fully sunlit Sydney evening pass', () => {
    const passes = findVisiblePasses(iss, 25544, sydney, darkWindows(sydney, from, to));
    const p = passes.find((x) => secondsApart(x.max.time, '2026-10-30T09:29:38Z') < 30);
    expect(p).toBeDefined();
    expect(secondsApart(p!.start.time, '2026-10-30T09:26:59Z')).toBeLessThanOrEqual(10);
    expect(secondsApart(p!.end.time, '2026-10-30T09:32:16Z')).toBeLessThanOrEqual(10);
    expect(Math.abs(p!.max.elevation - 21.3)).toBeLessThan(0.5);
    expect(Math.abs(p!.max.azimuth - 309)).toBeLessThan(2);
  });

  it('finds the high Tokyo pass on 31 Oct', () => {
    const passes = findVisiblePasses(iss, 25544, tokyo, darkWindows(tokyo, from, to));
    const p = passes.find((x) => secondsApart(x.max.time, '2026-10-31T20:16:13Z') < 30);
    expect(p).toBeDefined();
    expect(Math.abs(p!.max.elevation - 51.2)).toBeLessThan(0.5);
  });
});
