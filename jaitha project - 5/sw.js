const CACHE_NAME = 'secret-spots-recon-v8';
const TILE_CACHE = 'secret-spots-tiles-v1';
const MAX_TILES = 400;

const LOCAL_ASSETS = [
  './', './index.html', './login.html', './ai.html', './css/styles.css', './css/login.css', './css/ai.css',
  './js/config.js', './js/auth.js', './js/login.js', './js/passport.js', './js/spots-data.js', './js/algorithms.js', './js/storage.js', './js/app.js', './js/ai.js',
  './manifest.json', './lib/leaflet/leaflet.js', './lib/leaflet/leaflet.css', './icons/icon-192.png', './icons/icon-512.png'
];
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(LOCAL_ASSETS);
    // CDN files are cross-origin: fetch as no-cors and tolerate individual failures
    await Promise.all(CDN_ASSETS.map(async url => {
      try { await cache.put(url, await fetch(new Request(url, { mode: 'no-cors' }))); } catch (e) {}
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => cache.delete(k)));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: cache-first, refresh in background, keep the most recent N for offline viewing
  if (/(tile\.openstreetmap\.org|tile\.opentopomap\.org|arcgisonline\.com)$/.test(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        cache.put(req, res.clone()).then(() => trimTiles(cache));
        return res;
      } catch (e) { return new Response('', { status: 504 }); }
    })());
    return;
  }

  // Only handle our own files and the pinned CDN libs; leave Google sign-in etc. untouched
  const ours = url.origin === self.location.origin || CDN_ASSETS.includes(req.url);
  if (!ours) return;

  // App shell & CDN: cache-first, fall back to network, then to index for navigations
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      if (req.mode === 'navigate') return caches.match('./index.html');
      return new Response('', { status: 504 });
    }
  })());
});
