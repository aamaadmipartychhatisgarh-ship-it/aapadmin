"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

// Polls the per-user notification feed and raises a browser-native popup for any
// new task assignment. Falls back to an in-app toast when the user hasn't granted
// OS notification permission, so the alert is never lost. Renders no persistent UI.
const SEEN_KEY = "notif_seen_ids";
function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); }
}
function saveSeen(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-200))); } catch { /* ignore */ }
}

export default function TaskNotifier() {
  const { status } = useSession();
  const seenRef = useRef(null);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (seenRef.current === null) seenRef.current = loadSeen();

    // Ask once for OS notification permission.
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    let stopped = false;
    async function poll() {
      try {
        const r = await fetch("/api/me/notifications");
        if (!r.ok) return;
        const { notifications } = await r.json();
        const fresh = (notifications || []).filter((n) => !n.is_read && !seenRef.current.has(n.id));
        if (!fresh.length) return;

        const granted = typeof Notification !== "undefined" && Notification.permission === "granted";
        for (const n of fresh) {
          seenRef.current.add(n.id);
          if (granted) {
            try {
              const notif = new Notification(n.title, { body: n.body || "", tag: `notif-${n.id}` });
              notif.onclick = () => { window.focus(); if (n.link) window.location.href = n.link; notif.close(); };
            } catch { /* ignore */ }
          } else {
            setToasts((t) => [...t, { id: n.id, title: n.title, body: n.body, link: n.link }]);
            setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 9000);
          }
        }
        saveSeen(seenRef.current);
        // Mark shown notifications read so they don't fire again.
        fetch("/api/me/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: fresh.map((n) => n.id) }),
        }).catch(() => {});
      } catch { /* ignore transient errors */ }
    }

    poll();
    const iv = setInterval(() => { if (!stopped) poll(); }, 20000);
    return () => { stopped = true; clearInterval(iv); };
  }, [status]);

  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] space-y-2 w-80 max-w-[90vw]">
      {toasts.map((t) => (
        <a
          key={t.id}
          href={t.link || "#"}
          onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
          className="block bg-white border border-gray-200 shadow-lg rounded-xl p-3 hover:bg-gray-50 animate-in slide-in-from-right duration-300"
        >
          <div className="text-sm font-bold text-gray-900">{t.title}</div>
          {t.body && <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{t.body}</div>}
          <div className="text-[10px] text-[#164FA3] font-semibold mt-1">Open Tasks →</div>
        </a>
      ))}
    </div>
  );
}
