const CACHE = 'zeroin-v4';
const FILES = ['./', './index.html', './app.js', './data.json', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first with a short timeout, so updates show up right away when there's signal.
// No signal (or a weak one): answer from the saved copy, so the app always works in the field.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request, {ignoreSearch: true});
    const net = fetch(e.request.url, {cache: 'no-cache'}).then(res => { if (res && res.ok) cache.put(e.request, res.clone()); return res; });
    if (!hit) return net;
    const timeout = new Promise(r => setTimeout(() => r(hit), 2500));
    return Promise.race([net.catch(() => hit), timeout]);
  })());
});
