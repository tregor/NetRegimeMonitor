// Шаблон service worker. __PRECACHE_URLS__ подставляет scripts/postbuild.mjs.
const CACHE = 'nrm-shell-__BUILD_ID__';
const PRECACHE = __PRECACHE_URLS__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Замеры доступности и DNS всегда идут в сеть напрямую, в кеш не кладём.
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Страница: сеть, при отсутствии — кешированный шелл (офлайн).
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html', { ignoreSearch: true })),
    );
    return;
  }
  // Статика шелла: сначала кеш (мгновенно и офлайн), фоном обновляем.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
