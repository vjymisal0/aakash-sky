// All user-facing copy lives here so wording stays consistent across the app.
import type { Category } from './core/catalog';
import type { Mission } from './core/describe';

const en = {
  tagline: 'Live satellites',
  live: 'LIVE',
  inOrbit: 'in orbit',
  search: 'Search satellite or NORAD ID',
  welcomeTitle: 'Satellites over India, live',
  welcomeBody:
  'Every dot on the globe is a real satellite, positioned from public orbital data. Find out when the space station flies over your city tonight.',
  welcomeNote: 'Times and positions are computed from published orbits and can drift by a few seconds. Not for any safety-critical use.',
  explore: 'Explore the globe',
  findPass: 'When can I see one?',
  location: 'Your location',
  useMyLocation: 'Use my location',
  myLocation: 'My location',
  locating: 'Locating…',
  locationDenied: 'Location unavailable. Pick a city instead.',
  nextPass: 'Next visible pass',
  upcoming: 'Upcoming visible passes',
  computing: 'Calculating passes over the next 7 days…',
  noPasses: 'No naked-eye passes in the next 7 days from here. Visibility comes in seasons; check back next week.',
  appears: 'Appears',
  highest: 'Highest',
  disappears: 'Disappears',
  inMin: 'in {n} min',
  inHours: 'in {h} h {m} min',
  inDays: 'in {d} d {h} h',
  now: 'happening now',
  veryBright: 'Very bright',
  visible: 'Naked-eye',
  addCalendar: 'Add to calendar',
  showOnGlobe: 'Show on globe',
  minutes: '{n} min',
  filters: 'Layers',
  all: 'All',
  details: 'Satellite',
  close: 'Close',
  norad: 'NORAD ID',
  cospar: 'International ID',
  owner: 'Owner',
  launched: 'Launched',
  mission: 'Mission',
  orbit: 'Orbit',
  altitude: 'Altitude',
  speed: 'Speed',
  period: 'Period',
  inclination: 'Inclination',
  position: 'Over',
  lighting: 'Lighting',
  sunlit: 'In sunlight',
  shadow: "In Earth's shadow",
  elementsAge: 'Orbit data age',
  hoursAgo: '{n} h old',
  dataFrom: 'Orbital data',
  updated: 'updated',
  notForSafety: 'Approximate · not for safety-critical use',
  calendarTitle: '{name} visible: {from} → {to}, up to {el}°',
  calendarBody: 'Look {from} at {start}. It climbs to {el}° in the {max} and fades {to}. From {place}. Computed by Aakash from CelesTrak data.',
  lookUp: 'Look up',
  noResults: 'No satellite matches',
} as const;

export type Key = keyof typeof en;

const categories: Record<Category, string> = {
  station: 'Space stations',
  india: 'India',
  gnss: 'Navigation',
  weather: 'Weather',
  starlink: 'Starlink',
  oneweb: 'OneWeb',
  other: 'Other',
};

const missions: Record<Mission, string> = {
  navigation: 'Navigation',
  earthObservation: 'Earth observation',
  radar: 'Radar imaging',
  communication: 'Communication',
  weather: 'Weather',
  ocean: 'Ocean monitoring',
  science: 'Space science',
  student: 'Student satellite',
  crewed: 'Crewed space station',
  internet: 'Satellite internet',
};

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export const tCategory = (c: Category) => categories[c];
export const tMission = (m: Mission) => missions[m];
export const LOCALE = 'en-IN';
