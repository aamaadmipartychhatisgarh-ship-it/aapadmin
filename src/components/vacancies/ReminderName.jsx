"use client";

import { useState } from "react";
import { MessageCircle, Loader2 } from "lucide-react";

// A responsible person's name under "Assigned By": clicking it opens WhatsApp (app on phones, WhatsApp Web on
// desktop) with a pre-filled Hindi reminder listing every vacant post this person must fill in this Lok Sabha.
// The message is only pre-filled — the user reviews and sends it in WhatsApp. Nothing is recorded or sent here.
//
// A tab is opened synchronously on the click (so popup blockers allow it) and pointed at the wa.me link once the
// server has built the message; with no valid mobile the tab is closed and a clear notice is shown instead.

function notice(text) {
  try {
    const el = document.createElement("div");
    el.setAttribute("role", "alert");
    el.setAttribute("data-testid", "reminder-notice");
    el.textContent = text;
    el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:#dc2626;color:#fff;padding:10px 16px;border-radius:12px;font:500 14px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.2);max-width:90vw;text-align:center";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  } catch { /* no DOM */ }
}

export default function ReminderName({ contactId, name, lokSabhaId, className = "", children }) {
  const [busy, setBusy] = useState(false);
  if (!contactId) return <span className={className}>{children || name}</span>;
  const onClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    let win = null;
    try { win = window.open("", "_blank"); if (win) win.document.write("<p style=\"font-family:sans-serif;padding:24px\">Opening WhatsApp…</p>"); } catch { win = null; }
    try {
      const qs = new URLSearchParams({ contact_id: String(contactId), lok_sabha_id: lokSabhaId ? String(lokSabhaId) : "state" });
      const r = await fetch(`/api/vacancies/reminder-hi?${qs}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { try { win?.close(); } catch {} notice(d.message || "Could not prepare the reminder."); return; }
      if (!d.wa_url) { try { win?.close(); } catch {} notice(`${d.name || name} has no valid mobile number on record — WhatsApp cannot be opened.`); return; }
      if (win && !win.closed) { try { win.opener = null; } catch {} win.location.href = d.wa_url; }
      else window.open(d.wa_url, "_blank", "noopener,noreferrer");
    } catch {
      try { win?.close(); } catch {}
      notice("Could not prepare the reminder.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={onClick} data-testid="reminder-name" data-contact={contactId} data-ls={lokSabhaId || "state"}
      title={`WhatsApp a Hindi reminder to ${name} about the vacant posts in this Lok Sabha`}
      className={`inline-flex items-center gap-1 text-[#128C4B] hover:underline font-semibold max-w-full text-left ${className}`}>
      {busy ? <Loader2 size={12} className="animate-spin shrink-0" /> : <MessageCircle size={12} className="shrink-0" />}
      <span className="truncate">{children || name}</span>
    </button>
  );
}
