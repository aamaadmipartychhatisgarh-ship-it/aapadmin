"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";

// After a deploy the server has a new build, so pages still open in a browser
// reference old chunk filenames that now 404 (ChunkLoadError). Reload once to
// pull the fresh build. A short cooldown guarantees this can never loop if a
// reload doesn't resolve it (e.g. a stale CDN copy).
function useChunkErrorRecovery() {
  useEffect(() => {
    const KEY = "__chunk_reload_at";
    const isChunkError = (val) => {
      const name = val?.name || "";
      const msg = val?.message || String(val || "");
      return name === "ChunkLoadError" ||
        /Loading (chunk|CSS chunk)|Failed to load chunk|dynamically imported module/i.test(msg);
    };
    const recover = () => {
      let last = 0;
      try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch {}
      if (Date.now() - last < 15000) return; // already tried very recently
      try { sessionStorage.setItem(KEY, String(Date.now())); } catch {}
      window.location.reload();
    };
    const onError = (e) => { if (isChunkError(e?.error || e)) recover(); };
    const onRejection = (e) => { if (isChunkError(e?.reason)) recover(); };
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
}

export default function Providers({ children }) {
  useChunkErrorRecovery();
  return <SessionProvider>{children}</SessionProvider>;
}
