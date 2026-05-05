/* Offline cache — incrémenter CACHE_NAME après changements majeurs des assets */
const CACHE_NAME = 'notebook-travel-v2';

const PRECACHE_URLS = [
  '/manifest.json',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache =>
        Promise.all([
          cache.addAll(PRECACHE_URLS),
          fetch('/', { credentials: 'same-origin' })
            .then(r => (r.ok ? cache.put('/', r.clone()) : null))
            .catch(() => {}),
        ])
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation =
    request.mode === 'navigate' ||
    (request.destination === 'document') ||
    (request.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then(r => {
          if (r.ok && r.type === 'basic') {
            const copy = r.clone();
            caches.open(CACHE_NAME).then(c => c.put('/', copy)).catch(() => {});
          }
          return r;
        })
        .catch(() =>
          caches.match(request).then(m => m || caches.match('/') || caches.match('/index.html'))
        )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
