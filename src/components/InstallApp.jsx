"use client";

// "Install App" button — turns the web app into an installed standalone app
// (PWA), the way YouTube Music / Spotify web offer "Install".
//
// - Registers the service worker (required for installability).
// - Listens for the browser's `beforeinstallprompt` event and shows the button.
// - On click, triggers the native install prompt.
// - Hides itself when already installed or when the browser doesn't support it.
//
// Usage: <InstallApp variant="sidebar" /> or <InstallApp variant="login" />

import { useEffect, useState, useCallback } from "react";
import { Download } from "lucide-react";

export default function InstallApp({ variant = "sidebar", className = "" }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);

  // Register the service worker once.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    // Already running as an installed app?
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (standalone) setInstalled(true);
  }, []);

  // Capture the install prompt event.
  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch {}
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  // Nothing to show if installed, or the browser hasn't offered install yet.
  if (installed || !deferredPrompt) return null;

  if (variant === "login") {
    return (
      <button
        type="button"
        onClick={install}
        className={`mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-blue-200 text-[#0B3A82] bg-blue-50 hover:bg-blue-100 text-sm font-semibold transition ${className}`}
      >
        <Download size={16} />
        Install App
      </button>
    );
  }

  // sidebar variant
  return (
    <button
      type="button"
      onClick={install}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-md text-blue-100 hover:text-white hover:bg-white/10 w-full transition-all text-sm ${className}`}
    >
      <Download size={18} />
      <span>Install App</span>
    </button>
  );
}
