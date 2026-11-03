"use client";

import { useEffect } from "react";

// Registers the (inert, non-caching) service worker on the public registration pages, so the app can be installed straight from /join or
// /r/<token> - the install prompt then uses the registration manifest ("AAP"). Same /sw.js as the rest of the site; it never caches pages.
export default function RegistrationPwa() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then((reg) => reg.update?.().catch(() => {})).catch(() => {});
  }, []);
  return null;
}
