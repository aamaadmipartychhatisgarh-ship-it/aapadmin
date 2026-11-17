"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

// A RESPONSIBLE PERSON in their own box on the Tree Map (the post they hold): their name and a WhatsApp icon. Clicking either
// fetches — live, at that moment — every post that is vacant and assigned to this person (by Contact id, across all Wings
// and levels) and opens WhatsApp (app on phones, WhatsApp Web on desktop) to their registered mobile with ONE consolidated
// Hindi message pre-filled. The user reviews / edits and sends it in WhatsApp; nothing is sent or recorded here.
//
// A tab is opened synchronously on the click (so pop-up blockers allow it) and pointed at the wa.me link once the server
// has built the message. With no vacant post, or no valid mobile number, the tab is closed and a clear notice is shown —
// WhatsApp is never opened to a wrong or empty chat.

function notice(text, tone = "error") {
  try {
    document.querySelectorAll('[data-testid="reminder-notice"]').forEach((n) => n.remove());
    const el = document.createElement("div");
    el.setAttribute("role", "alert");
    el.setAttribute("data-testid", "reminder-notice");
    el.textContent = text;
    el.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:${tone === "info" ? "#374151" : "#dc2626"};color:#fff;padding:10px 16px;border-radius:12px;font:500 14px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.2);max-width:90vw;text-align:center`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  } catch { /* no DOM */ }
}

// The WhatsApp mark (brand glyph), drawn inline so it needs no extra icon package.
export function WhatsAppIcon({ size = 14, className = "" }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M16.04 3C9 3 3.3 8.68 3.3 15.7c0 2.24.59 4.43 1.71 6.36L3 29l7.15-1.87a12.7 12.7 0 0 0 5.89 1.45h.01c7.03 0 12.74-5.69 12.74-12.7C28.79 8.68 23.07 3 16.04 3Zm0 23.42h-.01a10.6 10.6 0 0 1-5.39-1.47l-.39-.23-4.24 1.11 1.13-4.12-.25-.42a10.5 10.5 0 0 1-1.620-5.6c0-5.84 4.77-10.6 10.65-10.6 5.86 0 10.64 4.76 10.64 10.6 0 5.85-4.78 10.6-10.52 10.6Zm5.83-7.94c-.32-.16-1.890-.93-2.18-1.04-.29-.11-.5-.16-.72.16-.21.32-.82 1.04-1.01 1.25-.18.21-.37.24-.69.08-.32-.16-1.35-.5-2.57-1.58-.95-.85-1.59-1.89-1.78-2.21-.19-.32-.02-.49.14-.65.14-.14.32-.37.48-.56.16-.18.21-.32.32-.53.11-.21.05-.4-.03-.56-.08-.16-.72-1.73-.98-2.37-.26-.62-.52-.54-.72-.55h-.61c-.21 0-.56.08-.85.4-.29.32-1.12 1.09-1.12 2.66 0 1.57 1.14 3.08 1.3 3.3.16.21 2.25 3.43 5.45 4.81.76.33 1.36.52 1.82.67.77.24 1.46.21 2.01.13.61-.09 1.89-.77 2.15-1.51.27-.74.27-1.38.19-1.51-.08-.13-.29-.21-.61-.37Z" />
    </svg>
  );
}

export default function ResponsibleWhatsApp({ contactId, name, className = "", nameClassName = "text-[#128C4B] hover:underline font-semibold" }) {
  const [busy, setBusy] = useState(false);
  if (!contactId) return <span className={className}>{name}</span>;
  const open = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    let win = null;
    try { win = window.open("", "_blank"); if (win) win.document.write("<p style=\"font-family:sans-serif;padding:24px\">Opening WhatsApp…</p>"); } catch { win = null; }
    const closeWin = () => { try { win?.close(); } catch { /* ignore */ } };
    try {
      const r = await fetch(`/api/vacancies/responsible-message?contact_id=${encodeURIComponent(contactId)}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { closeWin(); notice(d.message || "Could not prepare the WhatsApp message."); return; }
      if (!d.count) { closeWin(); notice(`No vacant posts are currently assigned to ${d.name || name}.`, "info"); return; }
      if (!d.wa_url) { closeWin(); notice(`${d.name || name} has no valid mobile number on record — WhatsApp cannot be opened.`); return; }
      if (win && !win.closed) { try { win.opener = null; } catch { /* ignore */ } win.location.href = d.wa_url; }
      else window.open(d.wa_url, "_blank", "noopener,noreferrer");
      // A Designation whose master name is not in English is sent as recorded (never machine-translated) — say so.
      if (d.names_not_english?.length) notice(`No English name in the Designation Master for: ${d.names_not_english.join(", ")} — shown as recorded. Please add the English name there.`, "info");
    } catch {
      closeWin();
      notice("Could not prepare the WhatsApp message — network error.");
    } finally {
      setBusy(false);
    }
  };
  const title = `WhatsApp ${name}: one message with every vacant post assigned to them`;
  return (
    <span className={`inline-flex items-center gap-1 min-w-0 max-w-full ${className}`}>
      <button type="button" onClick={open} data-testid="reminder-name" data-contact={contactId} title={title}
        className={`${nameClassName} min-w-0 truncate text-left`}>{name}</button>
      <button type="button" onClick={open} disabled={busy} data-testid="responsible-whatsapp" data-contact={contactId} title={title} aria-label={title}
        className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#25D366] text-white hover:bg-[#1ebe5b] disabled:opacity-60">
        {busy ? <Loader2 size={11} className="animate-spin" /> : <WhatsAppIcon size={12} />}
      </button>
    </span>
  );
}
