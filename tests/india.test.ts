import { describe, expect, it } from 'vitest';
import { json2satrec } from 'satellite.js';
import { crossing, isOverIndia, subPoint } from '../src/core/india';

describe('isOverIndia', () => {
  it.each([
    ['Delhi', 28.61, 77.21],
    ['Mumbai', 19.08, 72.88],
    ['Kolkata', 22.57, 88.36],
    ['Chennai', 13.08, 80.27],
    ['Kanyakumari', 8.09, 77.54],
    ['Leh', 34.15, 77.58],
    ['Srinagar', 34.08, 74.8],
    ['Itanagar', 27.08, 93.61],
    ['Guwahati', 26.14, 91.74],
    ['Bhuj', 23.24, 69.67],
    ['Port Blair', 11.62, 92.73],
    ['Kavaratti', 10.57, 72.64],
  ])('%s is inside', (_, lat, lon) => expect(isOverIndia(lat, lon)).toBe(true));

  it.each([
    ['Karachi', 24.86, 67.0],
    ['Lahore', 31.55, 74.0],
    ['Kathmandu', 27.72, 85.32],
    ['Dhaka', 23.81, 90.41],
    ['Colombo', 6.93, 79.86],
    ['Thimphu', 27.47, 89.64],
    ['Lhasa', 29.65, 91.1],
    ['Yangon', 16.84, 96.17],
    ['Malé', 4.18, 73.51],
    ['Arabian Sea', 15.0, 68.0],
  ])('%s is outside', (_, lat, lon) => expect(isOverIndia(lat, lon)).toBe(false));
});

describe('crossing', () => {
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

  it('brackets real ISS crossings of India with plausible durations', () => {
    // Scan 30 Oct 2026 and measure every crossing with crossing(), starting mid-way through.
    const durations: number[] = [];
    let start: number | null = null;
    for (let t = Date.parse('2026-10-30T00:00:00Z'); t < Date.parse('2026-10-31T00:00:00Z'); t += 20_000) {
      const p = subPoint(iss, new Date(t))!;
      const over = isOverIndia(p.lat, p.lon);
      if (over && start === null) start = t;
      if (!over && start !== null) {
        const c = crossing(iss, new Date((start + t) / 2));
        expect(c.leaves).not.toBeNull();
        expect(Math.abs(c.entered.getTime() - start)).toBeLessThanOrEqual(20_000);
        durations.push((c.leaves!.getTime() - c.entered.getTime()) / 60_000);
        start = null;
      }
    }
    expect(durations.length).toBeGreaterThan(2);
    // India is ~3,000 km across and the ISS moves ~460 km/min: no crossing lasts over 8 min.
    expect(Math.max(...durations)).toBeGreaterThan(3);
    expect(Math.max(...durations)).toBeLessThan(8);
  });
});
