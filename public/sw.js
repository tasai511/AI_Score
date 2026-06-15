const CACHE_NAME = "ai-score-v10";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/baseball-field.png",
  "./assets/batter-red.png",
  "./assets/batter-blue.png",
  "./assets/runner-red-outline.png",
  "./assets/runner-blue-outline.png",
  "./assets/score_matrix.png",
  "./assets/single.svg",
  "./assets/two-base.svg",
  "./assets/three-base.svg",
  "./assets/home-run.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  const shouldUseNetworkFirst =
    event.request.mode === "navigate" ||
    [".html", ".css", ".js", ".webmanifest"].some((extension) => requestUrl.pathname.endsWith(extension));

  if (shouldUseNetworkFirst) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const responseCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((cachedResponse) => cachedResponse || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request)
        .then((networkResponse) => {
          const responseCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
          return networkResponse;
        })
        .catch(() => {
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return undefined;
        });
    })
  );
});
