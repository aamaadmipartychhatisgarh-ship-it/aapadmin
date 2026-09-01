// Minimal service worker — required only so the PWA install prompt can be
// offered. It deliberately does NOT handle page navigations or API calls, so it
// can never trap the app on a stale/broken cached page or turn a server hiccup
// (e.g. a 504) into a hard-stuck screen. Navigations and /api/ always go
// straight to the network, uncached.

const CACHE = "aap-admin-v2";

self.addEventListener("install", () => {
  // Activate immediately on first install / update.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Drop every old cache (including the previous v1 that cached navigations),
  // then take control of open pages.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // NEVER intercept:
  //  - page navigations (mode 'navigate' / an HTML document) — the browser must
  //    always get the live server response, so a bad SW cache can't stick the
  //    homepage or mask a 504;
  //  - non-GET requests;
  //  - API / auth calls.
  // For everything else we simply don't call respondWith, so the request goes to
  // the network exactly as if no service worker were installed. This makes the
  // SW inert for correctness while still satisfying the installability check.
  if (
    req.mode === "navigate" ||
    req.method !== "GET" ||
    req.destination === "document" ||
    req.url.includes("/api/")
  ) {
    return;
  }
  // Pass-through for other GETs — no caching, no fallback, no way to break a page.
});
