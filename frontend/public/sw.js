// Runtime-caching service worker. Not a build-time precache list (Vite
// output filenames are content-hashed, so we can't know them ahead of
// time here) -- instead it caches whatever gets requested as it's
// requested, which is enough to make a previously-opened game load
// offline and skip re-fetching the (large) glb piece models on repeat
// visits.
const CACHE_NAME = "duel-cache-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The game's live state travels over the WebSocket -- never cache API/ws
  // handshake requests, only the static app shell (JS/CSS/models/icons).
  if (url.pathname.includes("/ws/") || url.pathname.startsWith("/duel/ws/")) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      // Stale-while-revalidate: instant load from cache when available,
      // with a background refetch for next time -- but that refetch must
      // not be what respondWith() awaits. Awaiting it here would mean a
      // flaky/slow connection (e.g. testing over the LAN through a
      // NAT/port-forward hop) turns a merely-slow first load into a hard
      // failure: `fetch(...).catch(() => cached)` with no cache entry yet
      // resolves to `undefined`, and respondWith(undefined) is a fetch
      // error the browser can't recover from, instead of just... waiting.
      if (cached) {
        event.waitUntil(
          fetch(request)
            .then((response) => {
              if (response.ok) cache.put(request, response.clone());
            })
            .catch(() => {}),
        );
        return cached;
      }
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
