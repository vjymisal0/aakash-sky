// Pure helpers for turning CelesTrak CSV downloads into the compact catalog the app loads.

/** Quote-aware CSV parser. Returns an array of objects keyed by the header row. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export const CATEGORIES = ['station', 'india', 'gnss', 'weather', 'starlink', 'oneweb', 'other'];

/**
 * Pick one display category per satellite. Order matters: a NavIC satellite is
 * both Indian and GNSS, and we want India to win for this audience.
 */
export function categorize({ name, norad, owner, groups }) {
  if (groups.stations.has(norad)) return 'station';
  if (owner === 'IND') return 'india';
  if (groups.gnss.has(norad)) return 'gnss';
  if (groups.weather.has(norad)) return 'weather';
  if (/^STARLINK/i.test(name)) return 'starlink';
  if (/^ONEWEB/i.test(name)) return 'oneweb';
  return 'other';
}

const FLAG_VISUAL = 1;

/**
 * Build the compact catalog. Each satellite is a positional array to keep the
 * file small; `fields` documents the layout so the client can decode it.
 */
export function buildCatalog({ activeCsv, satcatCsv, groupCsvs, generatedAt }) {
  const satcat = new Map(parseCsv(satcatCsv).map((s) => [Number(s.NORAD_CAT_ID), s]));
  const groups = Object.fromEntries(
    Object.entries(groupCsvs).map(([k, csv]) => [k, new Set(parseCsv(csv).map((r) => Number(r.NORAD_CAT_ID)))]),
  );

  const sats = [];
  for (const r of parseCsv(activeCsv)) {
    const norad = Number(r.NORAD_CAT_ID);
    if (!Number.isFinite(norad) || !r.EPOCH) continue;
    const meta = satcat.get(norad);
    const owner = meta?.OWNER ?? '';
    const name = r.OBJECT_NAME;
    const flags = groups.visual.has(norad) || groups.stations.has(norad) ? FLAG_VISUAL : 0;
    sats.push([
      name,
      norad,
      r.OBJECT_ID,
      r.EPOCH,
      Number(r.MEAN_MOTION),
      Number(r.ECCENTRICITY),
      Number(r.INCLINATION),
      Number(r.RA_OF_ASC_NODE),
      Number(r.ARG_OF_PERICENTER),
      Number(r.MEAN_ANOMALY),
      Number(r.BSTAR),
      Number(r.MEAN_MOTION_DOT),
      Number(r.MEAN_MOTION_DDOT),
      categorize({ name, norad, owner, groups }),
      owner,
      meta?.LAUNCH_DATE ?? '',
      flags,
    ]);
  }

  return {
    generatedAt,
    source: 'CelesTrak (celestrak.org) GP + SATCAT',
    fields: [
      'name', 'norad', 'objectId', 'epoch', 'meanMotion', 'eccentricity', 'inclination',
      'raan', 'argPericenter', 'meanAnomaly', 'bstar', 'meanMotionDot', 'meanMotionDdot',
      'category', 'owner', 'launchDate', 'flags',
    ],
    sats,
  };
}
