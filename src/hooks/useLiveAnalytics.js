"use client";

import { useEffect, useRef } from "react";

const POLL_MS = 45000;

// Keeps `onRefresh` firing whenever the Analytics dataset might be stale:
//   - every 45s on a lightweight poll, and
//   - immediately on tab focus/visibility (so returning to the tab is instant).
//
// It deliberately uses NO long-lived SSE connection. On this app's shared Node
// hosting a persistent EventSource holds a worker/connection slot for the life
// of every open Analytics tab, and the browser's EventSource auto-reconnects
// (~3s) whenever the proxy drops the stream — so those connections accumulate
// and starve ordinary requests (even GET / then returns 504). Polling can never
// hold a worker open, so it can't exhaust the process. The old
// /api/analytics/stream endpoint now returns 204 (stop-reconnecting) for any
// stale tab still pointing at it.
// Returns nothing — it's a side-effect-only subscription.
export function useLiveAnalytics(onRefresh) {
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    const poll = setInterval(() => cbRef.current(), POLL_MS);

    const onFocus = () => { if (document.visibilityState === "visible") cbRef.current(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);
}
