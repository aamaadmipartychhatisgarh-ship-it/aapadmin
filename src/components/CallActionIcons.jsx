"use client";

import { useState, useEffect, useRef } from "react";
import { Phone, MessageCircle, ClipboardCheck, Loader2, Check } from "lucide-react";

// Indian 10-digit mobile → wa.me international format (91XXXXXXXXXX, no '+').
// Falls back to stripping non-digits if the number already carries a prefix.
function toWhatsAppDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

// Call + WhatsApp icon buttons for a list row, with an optional inline
// "log call result" popover — callers can record the outcome + a note without
// leaving the list. Logging is caller-only (the /api/calls endpoint 403s for
// admin/supervisor sessions by design), so `canLog` should reflect that.
export default function CallActionIcons({ phone, personName, contactId, canLog = false, onLogged, size = 15 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!phone) return null;
  const wa = toWhatsAppDigits(phone);

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <a
        href={`tel:${phone}`}
        title={`Call ${personName || phone}`}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-50"
      >
        <Phone size={size} />
      </a>
      <a
        href={`https://wa.me/${wa}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`WhatsApp ${personName || phone}`}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-50"
      >
        <MessageCircle size={size} />
      </a>
      {canLog && (
        <div className="relative" ref={ref}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            title="Log call result"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#164FA3] hover:bg-blue-50"
          >
            <ClipboardCheck size={size} />
          </button>
          {open && (
            <QuickLogPopover
              phone={phone}
              personName={personName}
              contactId={contactId}
              onClose={() => setOpen(false)}
              onLogged={onLogged}
            />
          )}
        </div>
      )}
    </div>
  );
}

function QuickLogPopover({ phone, personName, contactId, onClose, onLogged }) {
  const [statuses, setStatuses] = useState([]);
  const [statusId, setStatusId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/statuses").then((r) => r.json()).then((d) => setStatuses(d.statuses || [])).catch(() => {});
  }, []);

  async function save() {
    if (!statusId) return;
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_name: personName || phone,
          phone_number: phone,
          status_id: statusId,
          remarks: remarks || null,
          contact_id: contactId || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).message || "Failed to log call");
      setDone(true);
      onLogged?.();
      setTimeout(onClose, 900);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="absolute right-0 mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-gray-100 p-3 z-50 space-y-2">
      {done ? (
        <div className="flex items-center gap-2 text-emerald-600 text-sm font-medium py-2 justify-center"><Check size={16} /> Logged</div>
      ) : (
        <>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Log call result</div>
          <select
            value={statusId}
            onChange={(e) => setStatusId(e.target.value)}
            className="w-full h-8 px-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-1 focus:ring-[#164FA3]"
          >
            <option value="">Select status…</option>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Note (optional)"
            rows={2}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-1 focus:ring-[#164FA3] resize-none"
          />
          {err && <div className="text-xs text-red-600">{err}</div>}
          <button
            onClick={save}
            disabled={!statusId || saving}
            className="w-full h-8 rounded-lg bg-[#164FA3] text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      )}
    </div>
  );
}
