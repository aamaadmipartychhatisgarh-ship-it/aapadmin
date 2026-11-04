// Minimal service worker — required so the PWA install prompt can be offered. It never caches anything and never touches API calls or
// other requests, so it cannot trap the app on a stale/broken page. The one thing it does for page loads is retry the web server's own
// transient 403 page (see handleNavigation below); every other navigation response goes straight through, uncached.

// v5: a new service-worker file so installed copies update (adds the transient-403 retry; v4 was the AAP rename).
const CACHE = "aap-v5";

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

// The web server in front of the app (Hostinger / LiteSpeed) sometimes answers a page load with ITS OWN 403 page - "Access to this
// resource on the server is denied!" - for a moment (an edge/WAF hiccup), although the app itself is fine. The app never produces that
// text. For page loads ONLY, when exactly that server page comes back, try again (twice, short pause); if it persists, show a clear
// page with a Retry button instead of a dead-end error. Every other response (including the app's own 403s, redirects and errors) is
// passed through untouched, and nothing is cached.
const SERVER_403_MARK = "Access to this resource on the server is denied";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function isServer403(res) {
  if (!res || res.status !== 403 || res.type === "opaque" || res.type === "opaqueredirect") return false;
  try { return (await res.clone().text()).includes(SERVER_403_MARK); } catch (e) { return false; }
}
const RETRY_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AAP - Please try again</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f7fb;color:#1f2937;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.c{background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.08);padding:28px;max-width:360px;text-align:center}h1{font-size:20px;margin:0 0 8px;color:#164FA3}p{font-size:14px;color:#4b5563;margin:0 0 18px}
a,button{display:inline-block;background:#164FA3;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer}</style></head>
<body><div class="c"><h1>The server is busy</h1><p>This page could not be opened right now. Please try again in a moment.</p><button onclick="location.reload()">Try again</button></div></body></html>`;
async function handleNavigation(req) {
  let res = await fetch(req);                       // a network failure behaves exactly as before (browser's own error page)
  for (let i = 0; i < 2 && (await isServer403(res)); i++) {
    await wait(700 * (i + 1));
    try { res = await fetch(req); } catch (e) { break; }
  }
  if (await isServer403(res)) {
    return new Response(RETRY_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate" && req.method === "GET") { event.respondWith(handleNavigation(req)); return; }
  // NEVER intercept:
  //  - page navigations are handled above ONLY to retry the web server's own transient 403 page; they are never cached;
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
