"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, ListChecks, Users, Loader2, CheckCircle2, History, ChevronRight } from "lucide-react";
import CallActionIcons from "@/components/CallActionIcons";
import Avatar from "@/components/Avatar";
import { formatDurationHrMinSec } from "@/lib/callDuration";

// My Workspace → Unfiltered Calls. The same workspace layout and calling
// workflow as Regular Calls (queue on the left, the blue "Calling" card, previous
// attempts and Log Outcome on the right), but fed ONLY by the caller's own
// Unfiltered Contacts (Unfiltered Contact → Assigned Calls) and saved ONLY to the
// unfiltered call records — regular contacts, assignments and calls are never
// read or written here.
const inputCls = "w-full bg-gray-50 border border-gray-200 text-gray-900 h-10 rounded-lg px-3 focus:ring-2 focus:ring-[#FCB712] outline-none";

export default function UnfilteredWorkspace({ statuses, onCounts, onBusy }) {
  const [view, setView] = useState("pending");
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [active, setActive] = useState(null); // { ...unfiltered call, started_at }
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [form, setForm] = useState({ status_id: "", remarks: "", sentiment: "" });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const timerRef = useRef(null);

  const load = useCallback(async (v = view) => {
    try {
      const r = await fetch(`/api/unfiltered-calls?view=${v}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setLoadErr(d.message || "Could not load your Unfiltered Calls."); return null; }
      setLoadErr(""); setData(d); onCounts?.(d.counts);
      return d;
    } catch {
      setLoadErr("Could not load your Unfiltered Calls.");
      return null;
    }
  }, [view, onCounts]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { onBusy?.(!!active); }, [active, onBusy]);

  useEffect(() => {
    if (!active) return undefined;
    timerRef.current = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - active.started_at) / 1000))), 1000);
    return () => clearInterval(timerRef.current);
  }, [active]);

  function start(call, { keepMessage = false } = {}) {
    if (!call) return;
    if (!keepMessage) setMessage("");
    setError("");
    setForm({ status_id: "", remarks: "", sentiment: "" });
    setElapsed(0);
    setActive({ ...call, started_at: Date.now() });
    setHistory([]); setHistoryOpen(false);
    fetch(`/api/unfiltered-calls/${call.id}/history`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { history: [] }))
      .then((d) => { setHistory(d.history || []); setHistoryOpen((d.history || []).length > 0); })
      .catch(() => {});
  }

  const isPicked = statuses.find((s) => String(s.id) === String(form.status_id))?.name === "Phone Picked";

  async function submit() {
    if (!form.status_id) { setError("Please pick a status"); return; }
    if (submitting) return;
    setSubmitting(true); setError("");
    try {
      const r = await fetch(`/api/unfiltered-calls/${active.id}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sentiment only applies to a connected ("Phone Picked") call; Positive / Supporter adds the
        // person to the Contact List automatically (server side).
        body: JSON.stringify({ status_id: Number(form.status_id), remarks: form.remarks, duration_seconds: elapsed, sentiment: isPicked ? form.sentiment : "" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || "Failed to save"); if (r.status === 404 || r.status === 409) { setActive(null); load(); } return; }
      const savedId = active.id;
      const savedDuration = elapsed;
      setActive(null);
      const fresh = await load("pending");
      if (view !== "pending") setView("pending");
      // Same rhythm as Regular Calls: move straight on to the next call.
      const nextCall = (fresh?.calls || []).find((c) => c.id !== savedId);
      const added = d.contact_sync?.action === "created" ? " Added to the Contact List." : d.contact_sync?.action === "updated" ? " Contact List record updated." : d.contact_sync?.action === "skipped" ? ` Not added to the Contact List (${d.contact_sync.reason}).` : "";
      setMessage(`Saved (${savedDuration}s) — ${d.completed ? "call completed" : "kept pending for a retry"}.${added}${nextCall ? " Next call ready." : " No more pending Unfiltered Calls."}`);
      if (nextCall) start(nextCall, { keepMessage: true });
    } finally {
      setSubmitting(false);
    }
  }

  const counts = data?.counts || { assigned: 0, completed: 0, pending: 0 };
  const calls = data?.calls || [];
  const firstPending = view === "pending" ? calls[0] : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-300" data-testid="unfiltered-workspace">
      {/* LEFT: unfiltered queue */}
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-3 text-[#164FA3]">
            <ListChecks size={18} />
            <h2 className="font-bold">Your Unfiltered Queue</h2>
          </div>
          <button
            onClick={() => start(firstPending)}
            disabled={!!active || !firstPending}
            data-testid="uw-start-next"
            className="w-full bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2"
          >
            <Play size={18} /> Start Next Call
          </button>
          <div className="mt-4 grid grid-cols-3 gap-2 text-sm" data-testid="uw-counts">
            <div className="bg-blue-50 rounded-xl p-3">
              <div className="text-blue-900 font-bold text-2xl">{counts.assigned}</div>
              <div className="text-blue-700 text-[11px] uppercase tracking-wide font-medium">Assigned</div>
            </div>
            <div className="bg-emerald-50 rounded-xl p-3">
              <div className="text-emerald-900 font-bold text-2xl">{counts.completed}</div>
              <div className="text-emerald-700 text-[11px] uppercase tracking-wide font-medium">Completed</div>
            </div>
            <div className="bg-amber-50 rounded-xl p-3">
              <div className="text-amber-900 font-bold text-2xl">{counts.pending}</div>
              <div className="text-amber-700 text-[11px] uppercase tracking-wide font-medium">Pending</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2"><Users size={16} /> Assigned to You</h3>
          </div>
          <div className="flex gap-1 mb-3">
            {[["pending", `Pending (${counts.pending})`], ["completed", `Completed (${counts.completed})`]].map(([k, label]) => (
              <button key={k} onClick={() => setView(k)} data-testid={`uw-tab-${k}`}
                className={`flex-1 h-8 rounded-lg text-xs font-semibold border ${view === k ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200"}`}>
                {label}
              </button>
            ))}
          </div>
          {loadErr ? (
            <div className="text-sm text-red-600">{loadErr}</div>
          ) : !data ? (
            <div className="py-4 text-center"><Loader2 className="animate-spin inline text-gray-400" size={18} /></div>
          ) : calls.length === 0 ? (
            <div className="text-gray-400 text-sm py-2">{view === "pending" ? "No pending Unfiltered Calls." : "No completed Unfiltered Calls yet."}</div>
          ) : (
            <ul className="space-y-1.5 max-h-[460px] overflow-y-auto">
              {calls.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => view === "pending" && start(c)}
                    disabled={view !== "pending" || !!active}
                    data-testid="uw-row"
                    className={`w-full text-left flex items-center gap-3 p-2.5 rounded-xl border ${active?.id === c.id ? "border-[#164FA3] bg-blue-50" : "border-gray-100 hover:bg-gray-50"} disabled:cursor-default`}
                  >
                    <Avatar name={c.person_name || c.phone_key} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-gray-900 truncate">{c.person_name || "Unnamed"}</div>
                      <div className="text-xs text-gray-500 font-mono" data-testid="uw-row-phone">{c.phone_key}</div>
                    </div>
                    {view === "pending"
                      ? (Number(c.attempts) > 0 && <span className="text-[10px] font-bold bg-[#FCB712] text-[#164FA3] px-2 py-0.5 rounded-full">RETRY ×{c.attempts}</span>)
                      : <span className="text-[11px] text-emerald-700 font-semibold">{c.call_status_name}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* RIGHT: active call */}
      <div className="lg:col-span-2 space-y-4">
        {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center gap-2" data-testid="uw-message"><CheckCircle2 size={18} />{message}</div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3" data-testid="uw-error">{error}</div>}

        {!active ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-gray-500">
            <Play size={28} className="mx-auto text-gray-300 mb-2" />
            <div className="font-semibold text-gray-700">No Unfiltered Call in progress</div>
            <div className="text-sm mt-1">Press <strong>Start Next Call</strong> or pick a pending call from your list.</div>
          </div>
        ) : (
          <>
            <div className="bg-[#164FA3] text-white rounded-2xl shadow-sm p-6" data-testid="uw-active">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wider text-blue-200 mb-1 flex items-center gap-2">
                    Calling · Unfiltered
                    {history.length > 0 && <span className="bg-[#FCB712] text-[#164FA3] text-[10px] font-bold px-2 py-0.5 rounded-full">RETRY ×{history.length}</span>}
                  </div>
                  <h2 className="text-3xl font-bold">{active.person_name || "Unnamed"}</h2>
                  <div className="text-blue-100 text-sm mt-1">{[active.designation, active.assembly, active.district].filter(Boolean).join(" · ") || "No other details"}</div>
                  {active.address && <div className="text-blue-200 text-xs mt-0.5">{active.address}</div>}
                  <div className="mt-3 flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-lg" data-testid="uw-active-phone">{active.phone_key}</span>
                    {/* Call / WhatsApp / copy only — no contactId, so nothing reads
                        or writes regular Contact history. */}
                    <CallActionIcons phone={active.phone_key} personName={active.person_name || ""} dark />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs uppercase tracking-wider text-blue-200">Duration</div>
                  <div className="text-2xl font-mono font-bold">{formatDurationHrMinSec(elapsed, "0 Sec")}</div>
                </div>
              </div>
            </div>

            {history.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-amber-200">
                <button onClick={() => setHistoryOpen(!historyOpen)} className="w-full p-4 flex items-center justify-between text-left">
                  <div className="flex items-center gap-2 text-amber-700"><History size={16} /><span className="font-bold text-sm">Previous attempts ({history.length})</span></div>
                  <ChevronRight size={16} className={`text-gray-400 transition-transform ${historyOpen ? "rotate-90" : ""}`} />
                </button>
                {historyOpen && (
                  <div className="border-t border-amber-100 divide-y divide-gray-100 max-h-[280px] overflow-y-auto" data-testid="uw-history">
                    {history.map((h) => (
                      <div key={h.id} className="p-4 text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-gray-900">{new Date(h.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                          <span className="text-xs text-gray-500">{h.agent_name} · {h.status_name}{h.sentiment ? ` · ${h.sentiment}` : ""}</span>
                        </div>
                        {h.remarks && <div className="text-gray-600 italic">&quot;{h.remarks}&quot;</div>}
                        {h.duration_seconds != null && <div className="text-xs text-gray-400 mt-1">{formatDurationHrMinSec(h.duration_seconds, "0 Sec")} talk</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4"><Square size={16} /> Log Outcome</h3>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Status *</label>
                  <select value={form.status_id} onChange={(e) => setForm({ ...form, status_id: e.target.value })} className={inputCls} aria-label="Status">
                    <option value="">Select…</option>
                    {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                {isPicked && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Sentiment</label>
                    <select value={form.sentiment} onChange={(e) => setForm({ ...form, sentiment: e.target.value })} className={inputCls} aria-label="Sentiment" data-testid="uw-sentiment">
                      <option value="">None</option>
                      <option value="positive">Positive</option>
                      <option value="supporter">Supporter</option>
                      <option value="neutral">Neutral</option>
                      <option value="negative">Negative</option>
                      <option value="opponent">Opponent</option>
                      <option value="not_supporter">Not a Supporter</option>
                      <option value="wrong_number">Wrong Number</option>
                    </select>
                    {(form.sentiment === "positive" || form.sentiment === "supporter") && (
                      <p className="text-[11px] text-emerald-700 mt-1">Positive / Supporter contacts are added to the Contact List automatically.</p>
                    )}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Remarks</label>
                  <textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={3} aria-label="Remarks"
                    className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#FCB712] outline-none resize-none" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 mt-5 flex-wrap">
                <button onClick={() => { setActive(null); setError(""); }} disabled={submitting} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={submit} disabled={submitting} data-testid="uw-save"
                  className="px-6 py-2.5 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center gap-2">
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Save &amp; Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
