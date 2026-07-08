// Minimal service worker — required for the PWA install prompt to be offered.
// We keep it network-first (no aggressive caching) so the dashboard always
// shows fresh data; the SW mainly exists to make the app "installable".

const CACHE = "aap-admin-v1";

self.addEventListener("install", (event) => {
  // Activate immediately on first install.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Clean up old caches and take control of open pages.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle GET; never cache API/auth calls — always go to network.
  if (req.method !== "GET" || req.url.includes("/api/")) return;

  // Network-first. On failure, fall back to any cached copy — but ALWAYS
  // resolve to a real Response. Returning undefined here throws
  // "Failed to convert value to 'Response'" and turns a transient network
  // blip into a hard-broken page for every client with the SW installed.
  event.respondWith(
    fetch(req).catch(async () => {
      const cached = (await caches.match(req)) || (await caches.match("/dashboard"));
      if (cached) return cached;
      // Nothing cached and the network is down — behave like a normal
      // network failure instead of crashing the fetch handler.
      return Response.error();
    })
  );
});
