const CACHE_NAME = "habit-fitness-shell-v20260713-entitlements";
const APP_INDEX = new URL("index.html", self.registration.scope).toString();
const APP_SHELL = [
  "./",
  "index.html",
  "privacy.html",
  "terms.html",
  "styles.css?v=20260713-entitlements-v1",
  "app.js?v=20260713-entitlements-v1",
  "app-icon.svg",
  "app-icon-180.png",
  "app-icon-192.png",
  "app-icon-512.png",
  "app-icon-maskable-512.png",
  "manifest.webmanifest"
].map(path => new URL(path, self.registration.scope).toString());

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match(APP_INDEX))
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      }))
  );
});
