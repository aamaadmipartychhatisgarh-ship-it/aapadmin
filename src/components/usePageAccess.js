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
        cache = { pages: Array.isArray(d.pages) ? d.pages : [] };
        inflight = null;
        listeners.forEach((fn) => fn(cache));
        return cache;
      })
      .catch(() => {
        cache = { pages: [] };
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
    loading: !state,
    has: (key) => !!state?.pages?.includes(key),
  };
}
