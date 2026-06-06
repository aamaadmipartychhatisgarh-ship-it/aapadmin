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

  event.respondWith(
    fetch(req).catch(() =>
      caches.match(req).then((res) => res || caches.match("/dashboard"))
    )
  );
});
