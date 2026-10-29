// Service worker: offline app shell and data, icons cached as they're seen.
// VERSION and PRECACHE are filled in by tools/build_site.py; a new deploy
// changes VERSION, which makes the browser install this worker again and the
// app offer a reload.

const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = `shell-${VERSION}`;
const ICONS = 'icons-v1'; // icon files are keyed by game icon id and never change

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('shell-') && key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (ev) => {
  if (ev.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.includes('/icons/')) {
    ev.respondWith((async () => {
      const cache = await caches.open(ICONS);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  ev.respondWith((async () => {
    const cache = await caches.open(SHELL);
    // Navigations (any hash route) are served the app page.
    const hit = req.mode === 'navigate'
      ? await cache.match('./') ?? await cache.match('index.html')
      : await cache.match(req, { ignoreSearch: true });
    return hit ?? fetch(req);
  })());
});
