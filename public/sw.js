// Offline support. Pages and orbital data are network-first, so a new deploy and fresh orbits
// reach people on their next visit; the cache answers only when the network is down.
// Hashed build assets never change, so they are cache-first.
const CACHE = 'aakash-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

function store(req, res) {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // The live orbit snapshot is the one cross-origin file worth keeping offline.
  const snapshot = url.origin === 'https://raw.githubusercontent.com' && url.pathname.startsWith('/vjymisal0/aakash-sky/data/');
  if (e.request.method !== 'GET' || (url.origin !== location.origin && !snapshot)) return;
  const immutable = url.pathname.includes('/assets/');
  if (!immutable) {
    e.respondWith(
      fetch(e.request)
        .then((res) => store(e.request, res))
        .catch(() => caches.match(e.request).then((hit) => hit || Response.error())),
    );
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => store(e.request, res))));
});
