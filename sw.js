// Keeps Stratrix working offline. Bump VERSION whenever index.html changes.
// Caches are shared with other apps on the same web address, so only Stratrix's own caches are ever cleared.
const VERSION = 'stratrix-v4';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('stratrix-') && k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Network first so updates arrive; the cached copy is the offline fallback.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith(
    // cache: 'no-cache' asks GitHub every time, so a new version shows on the next open instead of up to 10 minutes later
    fetch(e.request.url, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then(m => m || caches.match('./index.html')))
  );
});
