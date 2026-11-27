const CACHE = "elhelw-coffee-v30";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./production-calculator.css",
  "./production-calculator.js",
  "./procurement.js",
  "./erp-workspace.js",
  "./production-calculator/index.html",
  "./config.js",
  "./manifest.webmanifest",
  "./assets/pwa-icon.svg",
  "./assets/icon-192.png",
  "./assets/brand-logo.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Prefer the files bundled with the installed app. Fall back to the current cache
// only when the local request cannot be fulfilled.
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET") return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match("./index.html")))
  );
});
