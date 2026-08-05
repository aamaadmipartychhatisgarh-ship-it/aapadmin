"use client";

import { useState, useEffect, useRef } from "react";
import { Phone, MessageCircle, MessageSquare, Copy, UserRound, ClipboardCheck, Loader2, Check, History, PhoneCall, PhoneMissed, Clock, Flag } from "lucide-react";
import FloatingPopover from "@/components/FloatingPopover";

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

// Mirrors the wrong_number_reason ENUM (scripts/add-wrong-number-detail.mjs)
// and the Reports Engine's Wrong Number module filter options — keep in sync.
export const WRONG_NUMBER_REASONS = [
  { value: "not_in_service", label: "Not in service" },
  { value: "invalid_number", label: "Invalid number" },
  { value: "belongs_to_someone_else", label: "Belongs to someone else" },
  { value: "number_changed", label: "Number changed" },
  { value: "other", label: "Other" },
];

// Call + WhatsApp icon buttons for a list row. Every popover is rendered via
// FloatingPopover (portal + viewport-clamped fixed position) instead of
// `absolute right-0` — inside a horizontally-scrolled table (common on
// mobile) a plain `absolute` popover clips against the scroll container or
// lands off-screen, since its "right: 0" is relative to the trigger's own
// box, not the viewport.
//   canLog       show an inline "log call result" popover (caller-only — the
//                /api/calls endpoint 403s for admin/supervisor by design).
//   workerId     show a "Call History" icon with a stats popover (Picked / Not
//                Picked / etc. breakdown + total talk time), for the Workers list.
//   contactId    (without workerId) shows "Call History" as a plain call-log
//                list instead — for contact rows with no linked worker.
//   profileHref  if given, shows an "Open Profile" icon linking there.
//   dark         true on a colored/dark card background (e.g. the workspace's
//                active-call header) — swaps the per-action colors for a
//                uniform white/translucent style that reads on dark backgrounds.
export default function CallActionIcons({ phone, personName, contactId, workerId, canLog = false, onLogged, size = 15, profileHref, dark = false }) {
  const [logOpen, setLogOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const logRef = useRef(null);
  const waRef = useRef(null);
  const historyRef = useRef(null);
  const reportRef = useRef(null);

  if (!phone) return null;
  const wa = toWhatsAppDigits(phone);
  const cls = (light) => `w-7 h-7 rounded-lg flex items-center justify-center ${dark ? "text-white bg-white/10 hover:bg-white/20" : light}`;
  const copyNumber = () => {
    navigator.clipboard?.writeText(phone).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <a href={`tel:${phone}`} title={`Call ${personName || phone}`} className={cls("text-emerald-600 hover:bg-emerald-50")}>
        <Phone size={size} />
      </a>

      <button ref={waRef} type="button" onClick={() => setWaOpen((o) => !o)} title={`WhatsApp ${personName || phone}`} className={cls("text-emerald-600 hover:bg-emerald-50")}>
        <MessageCircle size={size} />
      </button>
      <FloatingPopover anchorRef={waRef} open={waOpen} onClose={() => setWaOpen(false)} width={240} estimatedHeight={280}>
        <WhatsAppTemplatePopover wa={wa} personName={personName} onClose={() => setWaOpen(false)} />
      </FloatingPopover>

      <a href={`sms:${phone}`} title={`SMS ${personName || phone}`} className={cls("text-sky-600 hover:bg-sky-50")}>
        <MessageSquare size={size} />
      </a>

      <button type="button" onClick={copyNumber} title="Copy number" className={cls("text-gray-500 hover:bg-gray-100")}>
        {copied ? <Check size={size} /> : <Copy size={size} />}
      </button>

      {(workerId || contactId) && (
        <>
          <button
            ref={historyRef}
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            title="Call history"
            className={cls("text-violet-600 hover:bg-violet-50")}
          >
            <History size={size} />
          </button>
          <FloatingPopover anchorRef={historyRef} open={historyOpen} onClose={() => setHistoryOpen(false)} width={workerId ? 256 : 280} estimatedHeight={260}>
            {workerId ? <CallHistoryPopover workerId={workerId} /> : <ContactHistoryPopover contactId={contactId} />}
          </FloatingPopover>
        </>
      )}

      {profileHref && (
        <a href={profileHref} title="Open profile" className={cls("text-indigo-600 hover:bg-indigo-50")}>
          <UserRound size={size} />
        </a>
      )}

      {canLog && (
        <>
          <button
            ref={logRef}
            type="button"
            onClick={() => setLogOpen((o) => !o)}
            title="Log call result"
            className={cls("text-[#164FA3] hover:bg-blue-50")}
          >
            <ClipboardCheck size={size} />
          </button>
          <FloatingPopover anchorRef={logRef} open={logOpen} onClose={() => setLogOpen(false)} width={256} estimatedHeight={220}>
            <QuickLogPopover
              phone={phone}
              personName={personName}
              contactId={contactId}
              onClose={() => setLogOpen(false)}
              onLogged={onLogged}
            />
          </FloatingPopover>
        </>
      )}

      {canLog && contactId && (
        <>
          <button
            ref={reportRef}
            type="button"
            onClick={() => setReportOpen((o) => !o)}
            title="Report wrong number / switched off"
            className={cls("text-amber-600 hover:bg-amber-50")}
          >
            <Flag size={size} />
          </button>
          <FloatingPopover anchorRef={reportRef} open={reportOpen} onClose={() => setReportOpen(false)} width={260} estimatedHeight={230}>
            <ReportIssuePopover contactId={contactId} onClose={() => setReportOpen(false)} />
          </FloatingPopover>
        </>
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
    <div className="py-1.5">
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

function CallHistoryPopover({ workerId }) {
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
    <div className="p-3">
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

// Raw call-log list for a contact with no linked worker (workerId's aggregate
// stats popover needs a worker row; this covers the plain-contact case).
function ContactHistoryPopover({ contactId }) {
  const [history, setHistory] = useState(null);

  useEffect(() => {
    fetch(`/api/contacts/${contactId}/history`).then((r) => r.json()).then((d) => setHistory(d.history || [])).catch(() => setHistory([]));
  }, [contactId]);

  return (
    <div className="p-3">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><History size={13} /> Call History</div>
      {history === null ? (
        <div className="py-4 flex items-center justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div>
      ) : history.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">No calls logged yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
          {history.map((h) => (
            <li key={h.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-900 text-xs">{new Date(h.called_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="text-xs text-gray-500 shrink-0">{h.status_name}</span>
              </div>
              {h.agent_name && <div className="text-[11px] text-gray-400">{h.agent_name}</div>}
              {h.remarks && <div className="text-gray-600 italic text-xs mt-0.5">"{h.remarks}"</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Step 1 of the number-correction workflow ("Caller marks number") — sends a
// pending request a supervisor later verifies and routes to a Designation.
// Separate from QuickLogPopover: logging "Wrong Number"/"Switched Off" as a
// call OUTCOME just records what happened on this call; this explicitly asks
// someone to go fix the data.
function ReportIssuePopover({ contactId, onClose }) {
  const [reason, setReason] = useState("wrong_number");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setSaving(true); setErr("");
    try {
      const r = await fetch(`/api/contacts/${contactId}/report-issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, note: note || undefined }),
      });
      if (!r.ok) throw new Error((await r.json()).message || "Failed to report");
      setDone(true);
      setTimeout(onClose, 900);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-3 space-y-2">
      {done ? (
        <div className="flex items-center gap-2 text-emerald-600 text-sm font-medium py-2 justify-center"><Check size={16} /> Reported — a supervisor will review it</div>
      ) : (
        <>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Report number issue</div>
          <div className="flex gap-1.5">
            {[["wrong_number", "Wrong Number"], ["switched_off", "Switched Off"]].map(([v, label]) => (
              <button key={v} type="button" onClick={() => setReason(v)}
                className={`flex-1 h-8 rounded-lg text-xs font-semibold border ${reason === v ? "bg-amber-500 text-white border-amber-500" : "bg-white text-gray-600 border-gray-200"}`}>
                {label}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            rows={2}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-1 focus:ring-[#164FA3] resize-none"
          />
          {err && <div className="text-xs text-red-600">{err}</div>}
          <button
            onClick={submit}
            disabled={saving}
            className="w-full h-8 rounded-lg bg-amber-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Flag size={14} />}
            {saving ? "Sending…" : "Send for review"}
          </button>
        </>
      )}
    </div>
  );
}

function QuickLogPopover({ phone, personName, contactId, onClose, onLogged }) {
  const [statuses, setStatuses] = useState([]);
  const [statusId, setStatusId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [wrongReason, setWrongReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/statuses").then((r) => r.json()).then((d) => setStatuses(d.statuses || [])).catch(() => {});
  }, []);

  const isWrongNumber = statuses.find((s) => String(s.id) === String(statusId))?.name === "Wrong Number";

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
          wrong_number_reason: isWrongNumber ? (wrongReason || undefined) : undefined,
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
    <div className="p-3 space-y-2">
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
          {isWrongNumber && (
            <select
              value={wrongReason}
              onChange={(e) => setWrongReason(e.target.value)}
              className="w-full h-8 px-2 rounded-lg border border-amber-200 bg-amber-50 text-sm outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="">Reason (optional)…</option>
              {WRONG_NUMBER_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          )}
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
