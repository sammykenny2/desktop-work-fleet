// Cache only the public editor shell. Private responses stay in explicit local storage.
const cacheName = 'work-fleet-shell-v1';
const assets = ['/', '/app.js', '/model.js', '/style.css'];
self.addEventListener('install', event => event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('work-fleet-shell-') && key !== cacheName).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !assets.includes(url.pathname) || url.search) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname)));
});
