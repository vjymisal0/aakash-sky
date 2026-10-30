import type { Category } from './core/catalog';
import type { CompassPoint, Mission } from './core/describe';

export type Lang = 'en' | 'hi';

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

const hi: Record<Key, string> = {
  tagline: 'लाइव उपग्रह',
  live: 'लाइव',
  inOrbit: 'कक्षा में',
  search: 'उपग्रह का नाम या NORAD ID खोजें',
  welcomeTitle: 'भारत के ऊपर उपग्रह, लाइव',
  welcomeBody:
    'ग्लोब पर हर बिंदु एक असली उपग्रह है, जिसकी स्थिति सार्वजनिक कक्षीय डेटा से निकाली गई है। जानिए आज रात अंतरिक्ष स्टेशन आपके शहर के ऊपर से कब गुज़रेगा।',
  welcomeNote: 'समय और स्थिति प्रकाशित कक्षाओं से गणना की जाती है और कुछ सेकंड आगे-पीछे हो सकती है। किसी भी सुरक्षा-संबंधी काम के लिए नहीं।',
  explore: 'ग्लोब देखें',
  findPass: 'मैं इसे कब देख सकता हूँ?',
  location: 'आपका स्थान',
  useMyLocation: 'मेरा स्थान इस्तेमाल करें',
  myLocation: 'मेरा स्थान',
  locating: 'स्थान खोजा जा रहा है…',
  locationDenied: 'स्थान उपलब्ध नहीं। कृपया शहर चुनें।',
  nextPass: 'अगली दिखने वाली उड़ान',
  upcoming: 'आने वाली दिखने वाली उड़ानें',
  computing: 'अगले 7 दिनों की उड़ानें गिनी जा रही हैं…',
  noPasses: 'अगले 7 दिनों में यहाँ से नंगी आँखों से दिखने वाली कोई उड़ान नहीं। यह मौसम के हिसाब से बदलता है; अगले हफ़्ते फिर देखें।',
  appears: 'दिखेगा',
  highest: 'सबसे ऊँचा',
  disappears: 'ओझल',
  inMin: '{n} मिनट में',
  inHours: '{h} घंटे {m} मिनट में',
  inDays: '{d} दिन {h} घंटे में',
  now: 'अभी दिख रहा है',
  veryBright: 'बहुत चमकीला',
  visible: 'नंगी आँखों से',
  addCalendar: 'कैलेंडर में जोड़ें',
  showOnGlobe: 'ग्लोब पर दिखाएँ',
  minutes: '{n} मिनट',
  filters: 'परतें',
  all: 'सभी',
  details: 'उपग्रह',
  close: 'बंद करें',
  norad: 'NORAD ID',
  cospar: 'अंतरराष्ट्रीय ID',
  owner: 'स्वामी',
  launched: 'प्रक्षेपण',
  mission: 'मिशन',
  orbit: 'कक्षा',
  altitude: 'ऊँचाई',
  speed: 'गति',
  period: 'परिक्रमा काल',
  inclination: 'झुकाव',
  position: 'ऊपर',
  lighting: 'रोशनी',
  sunlit: 'धूप में',
  shadow: 'पृथ्वी की छाया में',
  elementsAge: 'कक्षीय डेटा की उम्र',
  hoursAgo: '{n} घंटे पुराना',
  dataFrom: 'कक्षीय डेटा',
  updated: 'अपडेट',
  notForSafety: 'अनुमानित · सुरक्षा-संबंधी उपयोग के लिए नहीं',
  calendarTitle: '{name} दिखेगा: {from} → {to}, {el}° तक',
  calendarBody: '{start} पर {from} की ओर देखें। यह {max} में {el}° तक चढ़ेगा और {to} की ओर ओझल होगा। स्थान: {place}। Aakash द्वारा CelesTrak डेटा से गणना।',
  lookUp: 'ऊपर देखें',
  noResults: 'कोई उपग्रह नहीं मिला',
};

const categories: Record<Lang, Record<Category, string>> = {
  en: {
    station: 'Space stations',
    india: 'India',
    gnss: 'Navigation',
    weather: 'Weather',
    starlink: 'Starlink',
    oneweb: 'OneWeb',
    other: 'Other',
  },
  hi: {
    station: 'अंतरिक्ष स्टेशन',
    india: 'भारत',
    gnss: 'नेविगेशन',
    weather: 'मौसम',
    starlink: 'स्टारलिंक',
    oneweb: 'वनवेब',
    other: 'अन्य',
  },
};

const missions: Record<Lang, Record<Mission, string>> = {
  en: {
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
  },
  hi: {
    navigation: 'नेविगेशन',
    earthObservation: 'पृथ्वी अवलोकन',
    radar: 'रडार इमेजिंग',
    communication: 'संचार',
    weather: 'मौसम',
    ocean: 'समुद्र निगरानी',
    science: 'अंतरिक्ष विज्ञान',
    student: 'छात्र उपग्रह',
    crewed: 'मानवयुक्त अंतरिक्ष स्टेशन',
    internet: 'उपग्रह इंटरनेट',
  },
};

const compassHi: Record<CompassPoint, string> = {
  N: 'उत्तर',
  NNE: 'उत्तर-उत्तरपूर्व',
  NE: 'उत्तर-पूर्व',
  ENE: 'पूर्व-उत्तरपूर्व',
  E: 'पूर्व',
  ESE: 'पूर्व-दक्षिणपूर्व',
  SE: 'दक्षिण-पूर्व',
  SSE: 'दक्षिण-दक्षिणपूर्व',
  S: 'दक्षिण',
  SSW: 'दक्षिण-दक्षिणपश्चिम',
  SW: 'दक्षिण-पश्चिम',
  WSW: 'पश्चिम-दक्षिणपश्चिम',
  W: 'पश्चिम',
  WNW: 'पश्चिम-उत्तरपश्चिम',
  NW: 'उत्तर-पश्चिम',
  NNW: 'उत्तर-उत्तरपश्चिम',
};

let lang: Lang = (localStorage.getItem('lang') as Lang) || (navigator.language.startsWith('hi') ? 'hi' : 'en');

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  localStorage.setItem('lang', l);
  document.documentElement.lang = l;
}

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const s: string = (lang === 'hi' ? hi : en)[key];
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export const tCategory = (c: Category) => categories[lang][c];
export const tMission = (m: Mission) => missions[lang][m];
export const tCompass = (c: CompassPoint) => (lang === 'hi' ? compassHi[c] : c);
export const locale = () => (lang === 'hi' ? 'hi-IN' : 'en-IN');
