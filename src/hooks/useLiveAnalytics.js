"use client";

import { useEffect, useRef } from "react";

const SAFETY_POLL_MS = 60000;

// Keeps `onRefresh` firing whenever the Analytics dataset might be stale:
//   - instantly (debounced) on any live event pushed over SSE — several
//     mutations can land within the same second (e.g. a bulk worker import),
//     so bursts collapse into one refetch
//   - every 60s regardless, as a safety net — covers Hostinger's CDN/proxy
//     layer silently buffering or dropping the long-lived SSE connection,
//     which is unconfirmed on this host (see api/analytics/stream/route.js)
//   - immediately on tab focus/visibility, matching this app's existing
//     refetch pattern (see dashboard/map/page.js)
// Returns nothing — it's a side-effect-only subscription.
export function useLiveAnalytics(onRefresh) {
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    let debounceTimer;
    const debouncedRefresh = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => cbRef.current(), 400);
    };

    const es = new EventSource("/api/analytics/stream");
    es.onmessage = debouncedRefresh;
    // EventSource retries transient errors on its own (built-in ~3s backoff);
    // the safety-net poll below covers a connection that never recovers.
    es.onerror = () => {};

    const poll = setInterval(() => cbRef.current(), SAFETY_POLL_MS);

    const onFocus = () => { if (document.visibilityState === "visible") cbRef.current(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      clearTimeout(debounceTimer);
      es.close();
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);
}
