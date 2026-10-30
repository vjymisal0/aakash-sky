// All user-facing copy lives here so wording stays consistent across the app.
import type { Category } from './core/catalog';
import type { Mission } from './core/describe';

const en = {
  tagline: 'Live satellites',
  live: 'LIVE',
  booting: 'scanning Indian skies…',
  search: 'Search satellite or NORAD ID',
  tabGlobe: 'Map',
  tabIndia: 'Over India',
  tabTonight: 'Tonight',
  welcomeTitle: 'Satellites over India, live',
  welcomeBody:
    'Every icon on the map is a real satellite, positioned from public orbital data. See what is crossing India right now, and when the space station flies over your city.',
  welcomeNote: 'Positions are computed from published orbits and can drift by a few seconds. For information only, never for safety-critical use.',
  explore: 'Explore the map',
  findPass: 'When can I see one?',
  overIndiaTitle: 'Over India now',
  overhead: 'overhead',
  overIndiaChip: '{n} over India',
  filterList: 'Filter list · ISS, CARTOSAT, STARLINK',
  found: '{n} found',
  noneOver: 'Nothing in the selected layers is over India this moment. Give it a minute: a satellite crosses every few seconds.',
  noMatch: 'No satellite over India matches “{q}”.',
  sunlit: 'Sunlit',
  shadow: 'In shadow',
  leavesIn: 'leaves in {t}',
  leavingNow: 'leaving now',
  stays: 'stays overhead',
  location: 'Your location',
  useMyLocation: 'Use my location',
  nearMe: 'Near me',
  backToIndia: 'Back to India',
  toggle3d: 'Switch between map and globe',
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
  showOnGlobe: 'Show on map',
  minutes: '{n} min',
  all: 'All',
  close: 'Close',
  back: 'Back',
  share: 'Share',
  linkCopied: 'Link copied',
  trackLive: 'Track live',
  stopTracking: 'Stop tracking',
  overIndiaNow: 'Over India',
  overPoint: 'Over {pos}',
  visibleFrom: 'Visible from {place} {when}',
  notVisibleWeek: 'No naked-eye pass from {place} in the next 7 days',
  tooFaint: 'Too faint to see with the naked eye',
  norad: 'NORAD ID',
  cospar: 'International ID',
  owner: 'Owner',
  launched: 'Launched',
  orbit: 'Orbit',
  altitude: 'Altitude',
  speed: 'Speed',
  heading: 'Heading',
  period: 'Period',
  inclination: 'Inclination',
  position: 'Ground point',
  lighting: 'Lighting',
  inSunlight: 'In sunlight',
  inShadow: "In Earth's shadow",
  elementsAge: 'Orbit data age',
  hoursAgo: '{n} h old',
  dataFrom: 'Orbital data',
  updated: 'updated',
  notForSafety: 'Approximate · not for safety-critical use',
  calendarTitle: '{name} visible: {from} → {to}, up to {el}°',
  calendarBody: 'Look {from} at {start}. It climbs to {el}° in the {max} and fades {to}. From {place}. Computed by Aakash from CelesTrak data.',
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

/** Two-letter badges for list cards, like airline codes. */
const badges: Record<Category, string> = {
  station: 'ST',
  india: 'IN',
  gnss: 'NV',
  weather: 'WX',
  starlink: 'SL',
  oneweb: 'OW',
  other: 'SA',
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
export const tBadge = (c: Category) => badges[c];
export const tMission = (m: Mission) => missions[m];
export const LOCALE = 'en-IN';
