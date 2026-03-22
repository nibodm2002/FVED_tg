/* ===================================================================
   VED Telegram Mirror — Service Worker
   Caches core shell and serves offline-first
   =================================================================== */

const CACHE_NAME = 'ved-tg-v1';
const SHELL_FILES = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
];

// Install — cache shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
    );
    self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch — network-first for data, cache-first for shell
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Data files — always try network first
    if (url.pathname.includes('/data/')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Shell — cache first
    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
});
