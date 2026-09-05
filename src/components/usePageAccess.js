"use client";

import { useEffect, useState } from "react";

// BUG 14 — client access to the signed-in user's effective page keys, fetched
// from /api/my-pages (the ONE server source of truth: current DB assignments for
// THIS user, no role/default/cache fallback). Shared across every consumer (the
// dynamic sidebar + the page guard) so there is a single source of truth and no
// duplicate requests. A fresh load re-fetches, so a grant/revoke applies on the
// next load without a re-login.
//
// FAIL-CLOSED: if /api/my-pages fails (e.g. a transient 401 right after login, a
// network blip, a stale edge response), we RETRY with backoff and, until it
// succeeds, keep `pages === null` (a loading state) — we NEVER fall back to a
// permissive empty/role-based set. After the retries are exhausted we settle on
// an EMPTY, RESTRICTED set (no pages) rather than the user's role defaults, so a
// permission fetch failure can never surface old/default pages. A later focus/
// visibility revalidation (below) recovers automatically.

let cache = null;     // { pages: string[], restricted: bool, error: bool } once settled
let inflight = null;  // in-progress load promise (shared by all consumers)
const listeners = new Set();
const MAX_RETRIES = 3;

function notify() { listeners.forEach((fn) => fn(cache)); }

async function attempt(n) {
  try {
    const r = await fetch("/api/my-pages", { cache: "no-store" });
    if (!r.ok) throw new Error(`my-pages ${r.status}`);
    const d = await r.json();
    cache = { pages: Array.isArray(d.pages) ? d.pages : [], restricted: !!d.restricted, error: false };
  } catch (e) {
    if (n < MAX_RETRIES) {
      await new Promise((res) => setTimeout(res, 400 * (n + 1)));
      return attempt(n + 1);
    }
    // Exhausted retries → fail CLOSED (restricted, no pages). Never role defaults.
    cache = { pages: [], restricted: true, error: true };
  }
  inflight = null;
  notify();
  return cache;
}

function load() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = attempt(0);
  return inflight;
}

// Force a re-fetch (e.g. after the Super Admin changes grants, or a stale/failed
// load). Notifies all mounted consumers with the fresh set.
export function refreshPageAccess() {
  cache = null;
  inflight = null;
  return load();
}

// §11 — pick up permission changes for a user who is ALREADY logged in without a
// full reload: revalidate whenever the tab regains focus or becomes visible.
// Also self-heals a previous failed load (error state) the next time the tab is
// focused. Registered ONCE at module scope, so there is a single listener
// regardless of how many components use the hook. my-pages is no-store, so the
// refetch always returns the latest saved access.
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
    pages: state?.pages || null, // null while loading (never role defaults)
    restricted: !!state?.restricted,
    loading: !state,
    error: !!state?.error,
    has: (key) => !!state?.pages?.includes(key),
  };
}
