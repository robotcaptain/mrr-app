// Service Worker — MRR Radio
// Full implementation is in Task #11; this is the placeholder that gets
// registered immediately so the app can install as a PWA.
const CACHE_NAME = 'mrr-radio-v1';
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

  // Never cache MP3 streams
  if (url.pathname.endsWith('.mp3') || url.hostname.includes('blubrry')) {
    return; // network only
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
