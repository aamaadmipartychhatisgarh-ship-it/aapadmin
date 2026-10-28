"use client";

import { UNFILTERED_WRONG_REASONS, unfilteredWrongReasonLabel } from "@/lib/unfilteredWrongReasons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, ListChecks, Users, Loader2, CheckCircle2, History, ChevronRight, Pencil, X } from "lucide-react";
import CallActionIcons from "@/components/CallActionIcons";
import Avatar from "@/components/Avatar";
import ProfilePhoto from "@/components/ProfilePhoto";
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
  const [form, setForm] = useState({ status_id: "", remarks: "", sentiment: "", wrong_number_reason: "" });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const timerRef = useRef(null);
  const submitLock = useRef(false);        // synchronous guard: two quick clicks can't both pass before state updates
  const attemptedRef = useRef(new Set());  // calls already worked this session (kept pending after e.g. Busy): never offered as "next" again

  // Edit details (Photo, Address, Zone, Lok Sabha, District, Assembly, Block) - same fields as a regular call.
  // `editBase` is the snapshot the form was opened with: the server writes only what was changed from it.
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(null);
  const [editBase, setEditBase] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg] = useState("");
  const [editErr, setEditErr] = useState("");
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [editAssemblies, setEditAssemblies] = useState([]);
  useEffect(() => {
    if (!editing || zones.length) return;
    const get = (t, set) => fetch(`/api/locations?type=${t}`).then((r) => r.json()).then((d) => set((d.locations || []).filter((l) => l.type === t))).catch(() => {});
    get("zone", setZones); get("lok_sabha", setLokSabhas); get("district", setDistricts);
  }, [editing, zones.length]);
  useEffect(() => {
    if (!editing || !edit?.district_id) { setEditAssemblies([]); return; }
    fetch(`/api/locations?parent_id=${edit.district_id}`).then((r) => r.json()).then((d) => setEditAssemblies(d.locations || [])).catch(() => {});
  }, [editing, edit?.district_id]);

  const snapshot = (c) => ({
    address: c.address || "", zone_id: c.zone_id ? String(c.zone_id) : "", lok_sabha_id: c.lok_sabha_id ? String(c.lok_sabha_id) : "",
    district_id: c.district_id ? String(c.district_id) : "", assembly_id: c.assembly_id ? String(c.assembly_id) : "", ward_name: c.ward_name || "",
  });
  function openEdit() {
    const snap = snapshot(active);
    setEdit(snap); setEditBase(snap); setEditMsg(""); setEditErr(""); setEditing(true);
  }

  // Merge a saved record into the active card and the list, in place.
  function applyRecord(rec) {
    if (!rec) return;
    setActive((a) => (a && a.id === rec.id ? { ...a, ...rec } : a));
    setData((d) => (d ? { ...d, calls: d.calls.map((c) => (c.id === rec.id ? { ...c, ...rec } : c)) } : d));
  }

  async function saveEdit() {
    if (editSaving || !active) return;
    setEditSaving(true); setEditErr(""); setEditMsg("");
    try {
      const r = await fetch(`/api/unfiltered-calls/${active.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: edit.address, address_prev: editBase.address,
          zone_id: edit.zone_id, lok_sabha_id: edit.lok_sabha_id, district_id: edit.district_id, assembly_id: edit.assembly_id,
          geo_prev: { zone_id: editBase.zone_id, lok_sabha_id: editBase.lok_sabha_id, district_id: editBase.district_id, assembly_id: editBase.assembly_id },
          ward_name: edit.ward_name, ward_prev: editBase.ward_name,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setEditErr(d.message || "Could not save the details."); return; }
      applyRecord(d.record);
      if (d.address_conflict) { setEditErr("The address was changed by someone else after you opened this form, so your address edit was not applied. Reopen to see the latest."); }
      else { setEditMsg(d.no_change ? "No changes to save." : "Details saved."); }
      if (!d.address_conflict) setEditing(false);
    } catch {
      setEditErr("Could not save the details.");
    } finally {
      setEditSaving(false);
    }
  }

  async function saveActivePhoto(blob) {
    if (!active) return null;
    if (!blob) throw new Error("Photos can only be replaced here, not removed.");
    const fd = new FormData();
    fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
    const up = await fetch("/api/uploads", { method: "POST", body: fd });
    const upData = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(upData.message || "Upload failed");
    const r = await fetch(`/api/unfiltered-calls/${active.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photo_url: upData.url, photo_url_prev: active.photo_url || "" }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || `Could not save the photo (error ${r.status}).`);
    if (d.photo_ignored) throw new Error("The photo was changed by someone else meanwhile. Please reload and try again.");
    return upData.url;
  }

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
    setForm({ status_id: "", remarks: "", sentiment: "", wrong_number_reason: "" });
    setEditing(false); setEditMsg(""); setEditErr("");
    setElapsed(0);
    setActive({ ...call, started_at: Date.now() });
    setHistory([]); setHistoryOpen(false);
    fetch(`/api/unfiltered-calls/${call.id}/history`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { history: [] }))
      .then((d) => { setHistory(d.history || []); setHistoryOpen((d.history || []).length > 0); })
      .catch(() => {});
  }

  const isPicked = statuses.find((s) => String(s.id) === String(form.status_id))?.name === "Phone Picked";
  const isWrongNo = statuses.find((s) => String(s.id) === String(form.status_id))?.name === "Wrong Number";

  async function submit() {
    if (!form.status_id) { setError("Please pick a status"); return; }
    if (isWrongNo && !form.wrong_number_reason) { setError("Please select the Wrong Number reason"); return; }
    if (submitting || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true); setError("");
    try {
      const r = await fetch(`/api/unfiltered-calls/${active.id}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sentiment only applies to a connected ("Phone Picked") call; Positive / Supporter adds the
        // person to the Contact List automatically (server side).
        body: JSON.stringify({ status_id: Number(form.status_id), remarks: form.remarks, duration_seconds: elapsed, sentiment: isPicked ? form.sentiment : "", wrong_number_reason: isWrongNo ? form.wrong_number_reason : "" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || "Failed to save"); if (r.status === 404 || r.status === 409) { setActive(null); load(); } return; }
      const savedId = active.id;
      const savedDuration = elapsed;
      setActive(null);
      const fresh = await load("pending");
      if (view !== "pending") setView("pending");
      // Same rhythm as Regular Calls: move straight on to the next call.
      // A call kept pending for a retry (Busy, Not Picked...) stays at the head of the queue; "next" is the
      // following call in list order that has not been worked yet this session - never the one just saved.
      attemptedRef.current.add(savedId);
      const nextCall = (fresh?.calls || []).find((c) => !attemptedRef.current.has(c.id));
      const retryLeft = (fresh?.calls || []).length;
      const added = d.contact_sync?.action === "created" ? " Added to the Contact List." : d.contact_sync?.action === "updated" ? " Contact List record updated." : d.contact_sync?.action === "skipped" ? ` Not added to the Contact List (${d.contact_sync.reason}).` : "";
      setMessage(`Saved (${savedDuration}s) — ${d.completed ? "call completed" : "kept pending for a retry"}.${added}${!fresh ? " Could not refresh the queue." : nextCall ? " Next call ready." : retryLeft ? ` No more new calls - ${retryLeft} kept pending for a retry (use Start Next Call).` : " No more pending Unfiltered Calls."}`);
      if (nextCall) start(nextCall, { keepMessage: true });
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  // Release (no log): let go of the current call without logging it - same as Regular Calls. Nothing is saved on the call;
  // it stays in the queue, and is not offered as "next" again this session.
  async function releaseNoLog() {
    if (!active || submitting || submitLock.current) return;
    submitLock.current = true; setSubmitting(true); setError("");
    try {
      const r = await fetch(`/api/unfiltered-calls/${active.id}/release`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || "Could not release the call."); if (r.status === 404 || r.status === 409) { setActive(null); load(); } return; }
      attemptedRef.current.add(active.id);
      setActive(null);
      await load("pending");
      setMessage("Call released without logging. It stays in your queue.");
    } catch {
      setError("Could not release the call. Please try again.");
    } finally {
      submitLock.current = false; setSubmitting(false);
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
            onClick={() => { const fresh = calls.find((c) => !attemptedRef.current.has(c.id)); if (!fresh) attemptedRef.current.clear(); start(fresh || firstPending); }}
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
                      : <span className="text-[11px] text-emerald-700 font-semibold">{c.call_status_name}{c.wrong_number_reason ? ` · ${unfilteredWrongReasonLabel(c.wrong_number_reason) || c.wrong_number_reason}` : ""}</span>}
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
                <div className="shrink-0">
                  <ProfilePhoto
                    name={active.person_name}
                    src={active.photo_url}
                    size={84}
                    square
                    className="bg-white/15 border-2 border-white/25"
                    textClassName="text-white"
                    canRemove={false}
                    persist={saveActivePhoto}
                    onChange={(url) => applyRecord({ id: active.id, photo_url: url })}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-wider text-blue-200 mb-1 flex items-center gap-2">
                    Calling · Unfiltered
                    {history.length > 0 && <span className="bg-[#FCB712] text-[#164FA3] text-[10px] font-bold px-2 py-0.5 rounded-full">RETRY ×{history.length}</span>}
                  </div>
                  <h2 className="text-3xl font-bold">{active.person_name || "Unnamed"}</h2>
                  <div className="text-blue-100 text-sm mt-1">{[active.designation, active.assembly, active.district].filter(Boolean).join(" · ") || "No other details"}</div>
                  {active.address && <div className="text-blue-200 text-xs mt-0.5" data-testid="uw-active-address">{active.address}</div>}
                  {(active.zone_name || active.lok_sabha_name || active.ward_name) && (
                    <div className="text-blue-200 text-xs mt-0.5" data-testid="uw-active-geo">
                      {[active.zone_name && `Zone: ${active.zone_name}`, active.lok_sabha_name && `Lok Sabha: ${active.lok_sabha_name}`, active.ward_name && `Block: ${active.ward_name}`].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-lg" data-testid="uw-active-phone">{active.phone_key}</span>
                    {/* Call / WhatsApp / copy only — no contactId, so nothing reads
                        or writes regular Contact history. */}
                    <CallActionIcons phone={active.phone_key} personName={active.person_name || ""} dark />
                    <button type="button" onClick={() => (editing ? setEditing(false) : openEdit())} data-testid="uw-edit-toggle"
                      className="inline-flex items-center gap-1 text-xs font-semibold bg-white/15 hover:bg-white/25 px-2.5 py-1 rounded-lg">
                      <Pencil size={12} /> {editing ? "Close edit" : "Edit details"}
                    </button>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs uppercase tracking-wider text-blue-200">Duration</div>
                  <div className="text-2xl font-mono font-bold">{formatDurationHrMinSec(elapsed, "0 Sec")}</div>
                </div>
              </div>
            </div>


            {(editMsg || editErr) && !editing && (
              <div className={`${editErr ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"} border rounded-xl p-3 text-sm`} data-testid="uw-edit-message">{editErr || editMsg}</div>
            )}
            {editing && edit && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6" data-testid="uw-edit-form">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4"><Pencil size={16} /> Edit details</h3>
                {editErr && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm mb-3" data-testid="uw-edit-error">{editErr}</div>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Address</label>
                    <textarea value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} rows={2} aria-label="Address" data-testid="uw-edit-address"
                      className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#FCB712] outline-none resize-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Zone</label>
                    <select value={edit.zone_id} onChange={(e) => setEdit({ ...edit, zone_id: e.target.value })} className={inputCls} aria-label="Zone" data-testid="uw-edit-zone">
                      <option value="">Select…</option>
                      {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Lok Sabha</label>
                    <select value={edit.lok_sabha_id} onChange={(e) => setEdit({ ...edit, lok_sabha_id: e.target.value })} className={inputCls} aria-label="Lok Sabha" data-testid="uw-edit-ls">
                      <option value="">Select…</option>
                      {lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">District</label>
                    <select value={edit.district_id} onChange={(e) => setEdit({ ...edit, district_id: e.target.value, assembly_id: e.target.value === edit.district_id ? edit.assembly_id : "" })} className={inputCls} aria-label="District" data-testid="uw-edit-district">
                      <option value="">Select…</option>
                      {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Assembly</label>
                    <select value={edit.assembly_id} onChange={(e) => setEdit({ ...edit, assembly_id: e.target.value })} disabled={!edit.district_id} className={`${inputCls} disabled:opacity-60`} aria-label="Assembly" data-testid="uw-edit-assembly">
                      <option value="">Select…</option>
                      {editAssemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Block</label>
                    <input value={edit.ward_name} onChange={(e) => setEdit({ ...edit, ward_name: e.target.value })} className={inputCls} aria-label="Block" data-testid="uw-edit-block" maxLength={150} />
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 mt-3">The photo is changed from the picture above. Only the fields you change are saved; empty fields never clear existing data.</p>
                <div className="flex items-center justify-end gap-3 mt-4">
                  <button onClick={() => setEditing(false)} disabled={editSaving} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                  <button onClick={saveEdit} disabled={editSaving} data-testid="uw-edit-save"
                    className="px-5 py-2 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center gap-2">
                    {editSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Save details
                  </button>
                </div>
              </div>
            )}

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
                          <span className="text-xs text-gray-500">{h.agent_name} · {h.status_name}{h.wrong_number_reason ? ` · ${unfilteredWrongReasonLabel(h.wrong_number_reason) || h.wrong_number_reason}` : ""}{h.sentiment ? ` · ${h.sentiment}` : ""}</span>
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
                  <select value={form.status_id} onChange={(e) => setForm({ ...form, status_id: e.target.value, wrong_number_reason: "" })} className={inputCls} aria-label="Status">
                    <option value="">Select…</option>
                    {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                {isWrongNo && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Wrong Number reason *</label>
                    <select value={form.wrong_number_reason} onChange={(e) => setForm({ ...form, wrong_number_reason: e.target.value })} className={inputCls} aria-label="Wrong Number reason" data-testid="uw-wrong-reason">
                      <option value="">Select reason…</option>
                      {UNFILTERED_WRONG_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                )}
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
                <button onClick={releaseNoLog} disabled={submitting} data-testid="uw-release" className="px-4 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-2"><X size={16} /> Release (no log)</button>
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
