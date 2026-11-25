// Offline support.
// App code (HTML, CSS, JS, data) is fetched from the network first, so updates show up on the next load.
// Falls back to the cached copy when offline. Exercise images are cached as they are viewed.
const CACHE = 'workout-app-v11';
const SHELL = ['./', 'index.html', 'styles.css', 'lib.js', 'body.js', 'app.js', 'vendor/three.min.js', 'manifest.webmanifest',
  'data/exercises.json', 'exercise-names.txt', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function isImage(url) { return /\/img\/|\/model\//.test(url.pathname); }

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (isImage(url)) {
    // Large, rarely-changing files: cache first.
    e.respondWith(caches.open(CACHE).then((cache) => cache.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    })));
    return;
  }

  // App code: network first, cached copy when offline.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) caches.open(CACHE).then((cache) => cache.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.open(CACHE).then((cache) => cache.match(e.request))));
});
