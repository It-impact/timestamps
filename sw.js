// Serve from cache for instant/offline loads, refresh the cache in the background.
var CACHE = 'timestamp-manager-v1';
var FILES = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.json', 'icon.png'];

self.addEventListener('install', function (e) {
    e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
    if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
    e.respondWith(caches.open(CACHE).then(function (cache) {
        return cache.match(e.request).then(function (hit) {
            var fresh = fetch(e.request).then(function (res) {
                if (res && res.ok) cache.put(e.request, res.clone());
                return res;
            }).catch(function () { return hit; });
            return hit || fresh;
        });
    }));
});
