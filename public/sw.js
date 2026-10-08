const CACHE_NAME = 'moneylens-shell-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    // Vite emits fingerprinted JS/CSS filenames. Read the production HTML and
    // cache those same-origin bundles during install so the first offline reopen
    // does not depend on a second online page load.
    const response = await fetch('/index.html');
    if (response.ok) {
      const html = await response.text();
      const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map((match) => match[1]);
      const currentShell = [...new Set([...APP_SHELL, ...assets])];
      if (assets.length) await cache.addAll(assets);
      const keep = new Set(currentShell.map((path) => new URL(path, self.location.origin).href));
      const oldRequests = await cache.keys();
      await Promise.all(oldRequests.filter((request) => !keep.has(request.url)).map((request) => cache.delete(request)));
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put('/index.html', response.clone());
          }
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Cache the app's own built assets on first use so the interface can reopen
  // without a connection. No user messages or financial data are sent here.
  if (url.pathname.startsWith('/assets/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/icon.svg') {
    const network = fetch(request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    });
    // Register the refresh synchronously, while still returning a cached asset
    // immediately to the page when one is available.
    event.waitUntil(network.catch(() => undefined));
    event.respondWith(caches.match(request).then((cached) => cached || network).catch(() => network));
  }
});
