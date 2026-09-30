// Offline support: serve from cache instantly, refresh the cache in the background.
// Every network fetch skips the browser's HTTP cache, so a new version is never
// replaced by a stale copy (GitHub Pages lets browsers cache files for 10 minutes).
var CACHE = 'timestamp-manager-v4';
var FILES = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.json', 'icon.png'];

self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(CACHE).then(function (c) {
            return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); }));
        }).then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
    if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
    e.respondWith(caches.open(CACHE).then(function (cache) {
        return cache.match(e.request, { ignoreSearch: true }).then(function (hit) {
            var fresh = fetch(e.request, { cache: 'no-cache' }).then(function (res) {
                if (res && res.ok) cache.put(e.request, res.clone());
                return res;
            }).catch(function () { return hit; });
            return hit || fresh;
        });
    }));
});
