"use client";

import { useEffect, useState } from "react";

// BUG 14 — client access to the signed-in user's effective page keys.
// Fetches /api/my-pages once per page load and shares the result across every
// consumer (the dynamic sidebar + the page guard) so there's a single source
// of truth and no duplicate requests. A fresh load re-fetches, so a grant or
// revoke applies immediately on refresh (§13) without a re-login.

let cache = null; // { pages: string[] }
let inflight = null;
const listeners = new Set();

async function load() {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch("/api/my-pages", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { pages: [] }))
      .then((d) => {
        cache = { pages: Array.isArray(d.pages) ? d.pages : [], restricted: !!d.restricted };
        inflight = null;
        listeners.forEach((fn) => fn(cache));
        return cache;
      })
      .catch(() => {
        cache = { pages: [], restricted: false };
        inflight = null;
        listeners.forEach((fn) => fn(cache));
        return cache;
      });
  }
  return inflight;
}

// Force a re-fetch (e.g. after the Super Admin changes grants). Notifies all
// mounted consumers with the fresh set.
export function refreshPageAccess() {
  cache = null;
  inflight = null;
  return load();
}

// §11 — pick up permission changes for a user who is ALREADY logged in without
// needing a full reload or re-login: revalidate whenever the tab regains focus
// or becomes visible again. Registered ONCE at module scope (not per consumer),
// so there is a single listener regardless of how many components use the hook.
// my-pages is no-store, so the refetch always returns the latest saved access.
if (typeof window !== "undefined" && !window.__pageAccessRevalidateBound) {
  window.__pageAccessRevalidateBound = true;
  const revalidate = () => { if (document.visibilityState !== "hidden") refreshPageAccess(); };
  window.addEventListener("focus", revalidate);
  document.addEventListener("visibilitychange", revalidate);
}

export function usePageAccess() {
  const [state, setState] = useState(cache);
  useEffect(() => {
    let alive = true;
    const onChange = (c) => { if (alive) setState(c); };
    listeners.add(onChange);
    if (cache) setState(cache);
    else load();
    return () => { alive = false; listeners.delete(onChange); };
  }, []);
  return {
    pages: state?.pages || null, // null while loading
    restricted: !!state?.restricted,
    loading: !state,
    has: (key) => !!state?.pages?.includes(key),
  };
}
