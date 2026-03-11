// Service Worker — MRR Radio
const CACHE_NAME = 'mrr-radio-v3';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.css',
  '/manifest.json',
  '/js/db.js',
  '/js/data-loader.js',
  '/js/player.js',
  '/js/app.js',
  '/js/ui/episode-list.js',
  '/js/ui/filters.js',
  '/js/ui/player-ui.js',
  '/js/ui/artist-view.js',
  '/js/ui/artist-index.js',
  '/js/ui/episode-detail.js',
  '/js/ui/nav-stack.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache MP3 streams or version checks
  if (url.pathname.endsWith('.mp3') || url.hostname.includes('blubrry')
      || url.pathname.includes('episodes-version.json')) {
    return; // network only
  }

  // Network-first: always fetch fresh, fall back to cache when offline
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
