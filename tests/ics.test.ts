import { describe, expect, it } from 'vitest';
import { escapeText, fold, toIcs } from '../src/core/ics';
import { compass, mission, orbitClass } from '../src/core/describe';

describe('ics', () => {
  const ics = toIcs(
    {
      uid: '25544-1@aakash',
      start: new Date('2026-11-02T00:07:00Z'),
      end: new Date('2026-11-02T00:12:00Z'),
      title: 'ISS visible: NNW → E, up to 25°',
      description: 'Look NNW; it climbs to 25°, then fades E.',
      alarmMinutes: 10,
    },
    new Date('2026-10-30T00:00:00Z'),
  );

  it('writes UTC times, an alarm and CRLF line endings', () => {
    expect(ics).toContain('DTSTART:20261102T000700Z\r\n');
    expect(ics).toContain('DTEND:20261102T001200Z\r\n');
    expect(ics).toContain('TRIGGER:-PT10M\r\n');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('escapes commas and semicolons', () => {
    expect(escapeText('a, b; c\nd')).toBe('a\\, b\\; c\\nd');
    expect(ics).toContain('Look NNW\\; it climbs to 25°\\, then fades E.');
  });

  it('folds long lines at 75 octets without splitting UTF-8 characters', () => {
    const line = `SUMMARY:${'अंतरिक्ष स्टेशन '.repeat(10)}`;
    const folded = fold(line);
    const enc = new TextEncoder();
    for (const part of folded.split('\r\n')) expect(enc.encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n ').join('')).toBe(line);
  });
});

describe('describe', () => {
  it('maps azimuth to 16 compass points', () => {
    expect(compass(0)).toBe('N');
    expect(compass(359)).toBe('N');
    expect(compass(45)).toBe('NE');
    expect(compass(-90)).toBe('W');
    expect(compass(202.5)).toBe('SSW');
  });

  it('labels Indian satellite families', () => {
    expect(mission({ name: 'NVS-02 (IRNSS-1K)', category: 'india' })).toBe('navigation');
    expect(mission({ name: 'CARTOSAT-3', category: 'india' })).toBe('earthObservation');
    expect(mission({ name: 'INSAT-3DS', category: 'india' })).toBe('weather');
    expect(mission({ name: 'GSAT-N2 (GSAT-20)', category: 'india' })).toBe('communication');
    expect(mission({ name: 'NISAR', category: 'india' })).toBe('radar');
    expect(mission({ name: 'EOS-06 (OCEANSAT-3)', category: 'india' })).toBe('ocean');
    expect(mission({ name: 'DRISHTI', category: 'india' })).toBeNull();
  });

  it('classifies orbits', () => {
    expect(orbitClass(15.49)).toBe('LEO');
    expect(orbitClass(1.0027)).toBe('GEO');
    expect(orbitClass(2.005)).toBe('MEO');
    expect(orbitClass(2.0, 0.7)).toBe('HEO');
  });
});
