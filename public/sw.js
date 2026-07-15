const CACHE_NAME = "habit-fitness-shell-v20260715-p0-settings-v2";
const LANDING_INDEX = new URL("index.html", self.registration.scope).toString();
const APP_INDEX = new URL("app/index.html", self.registration.scope).toString();
const APP_PATH = new URL("app/", self.registration.scope).pathname;
const APP_SHELL = [
  "./",
  "index.html",
  "app/",
  "app/index.html",
  "privacy.html",
  "terms.html",
  "styles.css?v=20260715-p0-settings-v2",
  "app.js?v=20260715-p0-settings-v2",
  "workout-session-model.js?v=20260715-p0-session-v1",
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
        .catch(async () => {
          const cachedRequest = await caches.match(request);
          if (cachedRequest) return cachedRequest;
          const isAppNavigation = url.pathname === APP_PATH.slice(0, -1) || url.pathname.startsWith(APP_PATH);
          return caches.match(isAppNavigation ? APP_INDEX : LANDING_INDEX);
        })
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
