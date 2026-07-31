"use client";

import { useState, useEffect, useRef } from "react";
import { Phone, MessageCircle, ClipboardCheck, Loader2, Check, History, PhoneCall, PhoneMissed, Clock } from "lucide-react";

// Indian 10-digit mobile → wa.me international format (91XXXXXXXXXX, no '+').
// Falls back to stripping non-digits if the number already carries a prefix.
function toWhatsAppDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

// Predefined WhatsApp messages for fast sending — {name} is replaced with the
// row's person name. Edit this list to change what's offered; no DB/admin UI
// backs it today (a static, easy-to-edit config, same pattern as the app's
// other small constant lists e.g. lib/navGroups.js).
export const WHATSAPP_TEMPLATES = [
  { key: "greeting", label: "Greeting", text: "Namaste {name}, this is a call from Aam Aadmi Party Chhattisgarh. How are you?" },
  { key: "followup", label: "Follow-up", text: "Hello {name}, following up on our earlier conversation. Please let us know your thoughts whenever convenient." },
  { key: "event", label: "Event invite", text: "Hello {name}, we would like to invite you to our upcoming party event. We'll share the details soon." },
  { key: "thanks", label: "Thank you", text: "Thank you {name} for your time and support. We truly appreciate it." },
  { key: "membership", label: "Membership reminder", text: "Hello {name}, this is a reminder to renew/complete your AAP membership. Let us know if you need any help." },
];

function fillTemplate(text, name) {
  return text.replace(/\{name\}/g, name || "");
}

// Call + WhatsApp icon buttons for a list row.
//   canLog    show an inline "log call result" popover (caller-only — the
//             /api/calls endpoint 403s for admin/supervisor by design).
//   workerId  show a "Call History" icon with a stats popover (Picked / Not
//             Picked / etc. breakdown + total talk time), for the Workers list.
export default function CallActionIcons({ phone, personName, contactId, workerId, canLog = false, onLogged, size = 15 }) {
  const [logOpen, setLogOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const logRef = useRef(null);
  const waRef = useRef(null);
  const historyRef = useRef(null);

  useEffect(() => {
    if (!logOpen && !waOpen && !historyOpen) return;
    const onDoc = (e) => {
      if (logRef.current && !logRef.current.contains(e.target)) setLogOpen(false);
      if (waRef.current && !waRef.current.contains(e.target)) setWaOpen(false);
      if (historyRef.current && !historyRef.current.contains(e.target)) setHistoryOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [logOpen, waOpen, historyOpen]);

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

      <div className="relative" ref={waRef}>
        <button
          type="button"
          onClick={() => setWaOpen((o) => !o)}
          title={`WhatsApp ${personName || phone}`}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-50"
        >
          <MessageCircle size={size} />
        </button>
        {waOpen && <WhatsAppTemplatePopover wa={wa} personName={personName} onClose={() => setWaOpen(false)} />}
      </div>

      {workerId && (
        <div className="relative" ref={historyRef}>
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            title="Call history"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-violet-600 hover:bg-violet-50"
          >
            <History size={size} />
          </button>
          {historyOpen && <CallHistoryPopover workerId={workerId} onClose={() => setHistoryOpen(false)} />}
        </div>
      )}

      {canLog && (
        <div className="relative" ref={logRef}>
          <button
            type="button"
            onClick={() => setLogOpen((o) => !o)}
            title="Log call result"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#164FA3] hover:bg-blue-50"
          >
            <ClipboardCheck size={size} />
          </button>
          {logOpen && (
            <QuickLogPopover
              phone={phone}
              personName={personName}
              contactId={contactId}
              onClose={() => setLogOpen(false)}
              onLogged={onLogged}
            />
          )}
        </div>
      )}
    </div>
  );
}

function WhatsAppTemplatePopover({ wa, personName, onClose }) {
  const open = (text) => {
    const url = text ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : `https://wa.me/${wa}`;
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  };
  return (
    <div className="absolute right-0 mt-1.5 w-60 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-50">
      <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Quick message</div>
      {WHATSAPP_TEMPLATES.map((t) => (
        <button
          key={t.key}
          onClick={() => open(fillTemplate(t.text, personName))}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
        >
          {t.label}
        </button>
      ))}
      <div className="border-t border-gray-100 mt-1 pt-1">
        <button onClick={() => open("")} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50">
          Open chat without a message
        </button>
      </div>
    </div>
  );
}

const STATUS_META = {
  "Phone Picked": { icon: PhoneCall, color: "text-emerald-600" },
  "Not Picked": { icon: PhoneMissed, color: "text-amber-600" },
  "Wrong Number": { icon: Phone, color: "text-gray-500" },
  "Rudely Behaved": { icon: Phone, color: "text-red-600" },
  "Busy": { icon: Clock, color: "text-violet-600" },
  "Switched Off": { icon: Phone, color: "text-sky-600" },
};

function CallHistoryPopover({ workerId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/workers/${workerId}/call-history`).then((r) => r.json()).then(setData).finally(() => setLoading(false));
  }, [workerId]);

  const fmtMinutes = (secs) => {
    const m = Math.floor(secs / 60), s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="absolute right-0 mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-gray-100 p-3 z-50">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><History size={13} /> Call History</div>
      {loading ? (
        <div className="py-4 flex items-center justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div>
      ) : !data || data.total === 0 ? (
        <p className="text-sm text-gray-400 py-2">No calls logged yet.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold text-gray-900">{data.total}</span>
            <span className="text-xs text-gray-400">total calls</span>
          </div>
          <div className="space-y-1">
            {Object.entries(data.by_status).map(([name, n]) => {
              const meta = STATUS_META[name] || { icon: Phone, color: "text-gray-500" };
              const Icon = meta.icon;
              return (
                <div key={name} className="flex items-center justify-between text-sm">
                  <span className={`flex items-center gap-1.5 ${meta.color}`}><Icon size={13} /> {name}</span>
                  <span className="font-semibold text-gray-700">{n}</span>
                </div>
              );
            })}
          </div>
          {data.talk_seconds > 0 && (
            <div className="flex items-center justify-between text-sm pt-1.5 border-t border-gray-100">
              <span className="text-gray-500">Total talk time</span>
              <span className="font-semibold text-gray-700">{fmtMinutes(data.talk_seconds)}</span>
            </div>
          )}
          {data.last_call_at && (
            <div className="text-[11px] text-gray-400 pt-1">
              Last: {new Date(data.last_call_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} — {data.last_call_status}
            </div>
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
