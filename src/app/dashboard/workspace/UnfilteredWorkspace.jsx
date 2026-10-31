"use client";

import { PHONE_PICKED_OPTIONS, NOT_ACTIVE_REASONS, UNFILTERED_FOLLOWUP_STATUSES, UNFILTERED_HIDDEN_STATUSES, UNFILTERED_FINAL_STATUSES, phonePickedLabel } from "@/lib/unfilteredPhonePicked";
import { UNFILTERED_WRONG_REASONS, unfilteredWrongReasonLabel } from "@/lib/unfilteredWrongReasons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Square, ListChecks, Users, Loader2, CheckCircle2, History, ChevronRight, Pencil, X } from "lucide-react";
import CallActionIcons from "@/components/CallActionIcons";
import Avatar from "@/components/Avatar";
import ProfilePhoto from "@/components/ProfilePhoto";
import DesignationWingRows from "@/components/contacts/DesignationWingRows";
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
  const [form, setForm] = useState({ status_id: "", remarks: "", sentiment: "", pp: "", wrong_number_reason: "", follow_up_date: "", follow_up_time: "" });
  const [submitting, setSubmitting] = useState(false);
  const [fuFilter, setFuFilter] = useState(""); // Follow-ups tab: show only this exact date
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
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

  // Designation + Wing masters (Master Data) for the Designation field of the edit form.
  const [desigs, setDesigs] = useState([]);
  const [wingMaster, setWingMaster] = useState([]);
  useEffect(() => {
    if (!editing || desigs.length) return;
    fetch("/api/designations", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.designations) setDesigs(d.designations); }).catch(() => {});
    fetch("/api/wings", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.wings) setWingMaster(d.wings); }).catch(() => {});
  }, [editing, desigs.length]);
  // The record's saved designation (a name) as a Designation + Wing row, once the master has loaded.
  const rowFor = (name) => {
    const d = desigs.find((x) => String(x.name).trim().toLowerCase() === String(name || "").trim().toLowerCase());
    if (!d) return { designation_id: "", wing: "" };
    const mainLc = new Set(wingMaster.filter((w) => w.is_main).map((w) => String(w.name).trim().toLowerCase()));
    const w = (d.wings && d.wings.length ? d.wings : d.wing ? [d.wing] : []).find((x) => !mainLc.has(String(x).trim().toLowerCase()));
    return { designation_id: d.id, wing: w || "" };
  };
  useEffect(() => {
    // The master finished loading after the form opened: fill the saved designation in (the baseline too, so it is not seen as an edit).
    if (!editing || !desigs.length || !edit || edit.drow) return;
    const r = rowFor(active?.designation);
    setEdit((e) => (e ? { ...e, drow: [r] } : e)); setEditBase((b) => (b ? { ...b, drow: [r] } : b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, desigs.length, wingMaster.length, edit?.drow]);
  const snapshot = (c) => ({
    person_name: c.person_name || "", phone_number: c.phone_key || "", drow: desigs.length ? [rowFor(c.designation)] : null,
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
          person_name: edit.person_name, person_name_prev: editBase.person_name,
          phone_number: edit.phone_number, phone_prev: editBase.phone_number,
          ...(edit.drow && edit.drow[0] ? { designation_row: edit.drow[0], designation_row_prev: editBase.drow?.[0] || { designation_id: "", wing: "" } } : {}),
          address: edit.address, address_prev: editBase.address,
          zone_id: edit.zone_id, lok_sabha_id: edit.lok_sabha_id, district_id: edit.district_id, assembly_id: edit.assembly_id,
          geo_prev: { zone_id: editBase.zone_id, lok_sabha_id: editBase.lok_sabha_id, district_id: editBase.district_id, assembly_id: editBase.assembly_id },
          ward_name: edit.ward_name, ward_prev: editBase.ward_name,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setEditErr(d.message || "Could not save the details."); return; }
      applyRecord(d.record);
      const conflict = d.address_conflict || d.name_conflict || d.phone_conflict;
      if (conflict) { setEditErr(`The ${[d.address_conflict && "address", d.name_conflict && "name", d.phone_conflict && "phone number"].filter(Boolean).join(" / ")} was changed by someone else after you opened this form, so that edit was not applied. Reopen to see the latest.`); }
      else { setEditMsg(d.no_change ? "No changes to save." : "Details saved."); }
      if (!conflict) setEditing(false);
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
      const r = await fetch(`/api/unfiltered-calls?view=${v}${v === "followups" && fuFilter ? `&date=${encodeURIComponent(fuFilter)}` : ""}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setLoadErr(d.message || "Could not load your Unfiltered Calls."); return null; }
      setLoadErr(""); setData(d); onCounts?.(d.counts);
      return d;
    } catch {
      setLoadErr("Could not load your Unfiltered Calls.");
      return null;
    }
  }, [view, onCounts, fuFilter]);
  useEffect(() => { load(); }, [load]);
  // Changes made elsewhere (an admin assigns, reassigns or removes calls) show up without a manual reload: re-read when the tab
  // becomes visible again and every minute, but never while a call is open (the open call and its form are left alone).
  useEffect(() => {
    if (active) return undefined;
    const refresh = () => { if (document.visibilityState === "visible") load(); };
    const t = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", refresh); };
  }, [active, load]);
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
    setForm({ status_id: "", remarks: "", sentiment: "", pp: "", wrong_number_reason: "", follow_up_date: "", follow_up_time: "" });
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
  // Follow-up date: Busy, Not Picked, Not in Service, Switched Off, Incoming Off.
  const isBusy = UNFILTERED_FOLLOWUP_STATUSES.includes(statuses.find((s) => String(s.id) === String(form.status_id))?.name);
  const isWrongStatus = statuses.find((s) => String(s.id) === String(form.status_id))?.name === "Wrong Number";
  // Phone Picked -> Active, or Not Active + a reason (Wrong Number | Opponent | Not Interested), saved as the sentiment value.
  const pickedValue = isPicked ? (form.pp === "active" ? "active" : form.pp === "not_active" ? form.sentiment : "") : "";
  const isWrongNo = isWrongStatus || (isPicked && pickedValue === "wrong_number");   // either way the Wrong Number reason is required

  async function submit() {
    if (!form.status_id) { setError("Please pick a status"); return; }
    if (isBusy && form.follow_up_time && !form.follow_up_date) { setError("Please select a Follow-up Date before choosing a Follow-up Time."); return; }
    if (isBusy && form.follow_up_date && form.follow_up_date < new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)) { setError("The follow-up date cannot be in the past."); return; }
    if (isPicked && !pickedValue) { setError(form.pp === "not_active" ? "Please select Wrong Number, Opponent or Not Interested" : "Please select Active or Not Active"); return; }
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
        body: JSON.stringify({ status_id: Number(form.status_id), remarks: form.remarks, duration_seconds: elapsed, sentiment: isPicked ? pickedValue : "", wrong_number_reason: isWrongNo ? form.wrong_number_reason : "", follow_up_date: isBusy ? form.follow_up_date : "", follow_up_time: isBusy && form.follow_up_date ? form.follow_up_time : "" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || "Failed to save"); if (r.status === 404 || r.status === 409) { setActive(null); load(); } return; }
      const savedId = active.id;
      const savedDuration = elapsed;
      // Wrong Number: the call (with its reason) is already saved - go straight to the Wrong Number page, no extra step.
      if (isWrongNo) {
        setActive(null);
        router.push("/dashboard/admin/wrong-numbers?tab=wrong");
        return;
      }
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
      setMessage(`Saved (${savedDuration}s) — ${d.completed ? "call completed" : form.follow_up_date && isBusy ? `follow-up scheduled for ${form.follow_up_date}${form.follow_up_time ? ` at ${form.follow_up_time}` : ""}` : "kept pending for a retry"}.${added}${!fresh ? " Could not refresh the queue." : nextCall ? " Next call ready." : retryLeft ? ` No more new calls - ${retryLeft} kept pending for a retry (use Start Next Call).` : " No more pending Unfiltered Calls."}`);
      if (nextCall) start(nextCall, { keepMessage: true });
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  // Change the Active / Not Active option of an already saved Phone Picked call: updates that record (no new log).
  async function changePhonePicked(id, option) {
    if (!option) return;
    setError("");
    try {
      const r = await fetch(`/api/unfiltered-calls/${id}/phone-picked`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ option }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || "Could not update the option."); return; }
      setMessage("Phone Picked option updated.");
      await load("completed");
    } catch { setError("Could not update the option."); }
  }

  // Re-edit a COMPLETED call: opens the saved record in edit mode with its saved outcome pre-filled. Nothing is logged or timed - saving
  // updates that same record (PUT /outcome); the call stays completed.
  function openCompleted(c) {
    if (!c || active) return;
    setMessage(""); setError("");
    const sent = String(c.call_sentiment || "");
    const pp = c.call_status_name === "Phone Picked" ? (sent === "active" ? "active" : sent ? "not_active" : "") : "";
    const f = { status_id: c.call_status_id ? String(c.call_status_id) : "", remarks: c.call_notes || "", sentiment: pp === "not_active" ? sent : "", pp, wrong_number_reason: c.wrong_number_reason || "", follow_up_date: "", follow_up_time: "" };
    setForm(f);
    setEditing(false); setEditMsg(""); setEditErr("");
    setElapsed(0);
    setActive({ ...c, started_at: Date.now(), editCompleted: true, prev: {
      status_id: c.call_status_id ? String(c.call_status_id) : "", remarks: c.call_notes || "", sentiment: sent, wrong_number_reason: c.wrong_number_reason || "",
      follow_up_date: c.follow_up_date ? String(c.follow_up_date).slice(0, 10) : "", follow_up_time: c.follow_up_time ? String(c.follow_up_time).slice(0, 5) : "",
    } });
    setHistory([]); setHistoryOpen(false);
    fetch(`/api/unfiltered-calls/${c.id}/history`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { history: [] })).then((d) => setHistory(d.history || [])).catch(() => {});
  }
  async function saveCompleted() {
    if (!active?.editCompleted || submitting || submitLock.current) return;
    if (!form.status_id) { setError("Please pick a status"); return; }
    if (isPicked && !pickedValue) { setError(form.pp === "not_active" ? "Please select Wrong Number, Opponent or Not Interested" : "Please select Active or Not Active"); return; }
    if (isWrongNo && !form.wrong_number_reason) { setError("Please select the Wrong Number reason"); return; }
    submitLock.current = true; setSubmitting(true); setError("");
    try {
      const r = await fetch(`/api/unfiltered-calls/${active.id}/outcome`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status_id: form.status_id, remarks: form.remarks, sentiment: isPicked ? pickedValue : "", wrong_number_reason: isWrongNo ? form.wrong_number_reason : "", follow_up_date: "", follow_up_time: "", prev: active.prev }),
      });
      const d = await r.json().catch(() => ({}));
      // On any failure the form stays open with everything the user entered.
      if (!r.ok) { setError(d.message || "Could not save the changes."); return; }
      setActive(null);
      await load("completed");
      setMessage(d.no_change ? "No changes to save." : "Completed call updated - same record, no new call was created.");
    } catch {
      setError("Could not save the changes - network error. Your edits are still on screen.");
    } finally {
      submitLock.current = false; setSubmitting(false);
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
      await load(view);
      setMessage("Call released without logging. It stays in your queue.");
    } catch {
      setError("Could not release the call. Please try again.");
    } finally {
      submitLock.current = false; setSubmitting(false);
    }
  }

  const counts = data?.counts || { assigned: 0, completed: 0, pending: 0, active: 0 };
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
          {/* Exactly four cards: Pending, Completed, Assigned, Active (each its own count from the server). */}
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm" data-testid="uw-counts">
            {[
              ["pending", "Pending", counts.pending, "bg-amber-50", "text-amber-900", "text-amber-700"],
              ["completed", "Completed", counts.completed, "bg-emerald-50", "text-emerald-900", "text-emerald-700"],
              ["assigned", "Assigned", counts.assigned, "bg-blue-50", "text-blue-900", "text-blue-700"],
              ["active", "Active", counts.active, "bg-violet-50", "text-violet-900", "text-violet-700"],
            ].map(([k, label, n, bg, big, small]) => (
              <div key={k} className={`${bg} rounded-xl p-3 min-w-0`} data-testid={`uw-count-${k}`}>
                <div className={`${big} font-bold text-2xl`}>{n}</div>
                <div className={`${small} text-[11px] uppercase tracking-wide font-medium`}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2"><Users size={16} /> Assigned to You</h3>
          </div>
          <div className="flex gap-1 mb-3">
            {[["pending", `Pending (${counts.pending})`], ["followups", `Follow-ups (${counts.followups || 0})`], ["completed", `Completed (${counts.completed})`]].map(([k, label]) => (
              <button key={k} onClick={() => setView(k)} data-testid={`uw-tab-${k}`}
                className={`flex-1 h-8 rounded-lg text-xs font-semibold border ${view === k ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200"}`}>
                {label}
              </button>
            ))}
          </div>
          {view === "followups" && (
            <div className="flex items-center gap-2 mb-2">
              <input type="date" value={fuFilter} onChange={(e) => setFuFilter(e.target.value)} aria-label="Filter follow-ups by date" data-testid="uw-followup-date-filter" className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white" />
              {fuFilter && <button type="button" onClick={() => setFuFilter("")} className="text-[11px] font-semibold text-gray-500 hover:text-gray-800 underline">Show all</button>}
            </div>
          )}
          {loadErr ? (
            <div className="text-sm text-red-600">{loadErr}</div>
          ) : !data ? (
            <div className="py-4 text-center"><Loader2 className="animate-spin inline text-gray-400" size={18} /></div>
          ) : calls.length === 0 ? (
            <div className="text-gray-400 text-sm py-2">{view === "pending" ? "No pending Unfiltered Calls." : view === "followups" ? (fuFilter ? "No follow-ups for this date." : "No scheduled follow-ups.") : "No completed Unfiltered Calls yet."}</div>
          ) : (
            <ul className="space-y-1.5 max-h-[460px] overflow-y-auto">
              {calls.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => (view === "pending" || view === "followups" ? start(c) : view === "completed" ? openCompleted(c) : null)}
                    disabled={!!active}
                    data-testid="uw-row"
                    title={view === "completed" ? "Open to edit this completed call" : undefined}
                    className={`w-full text-left flex items-center gap-3 p-2.5 rounded-xl border ${active?.id === c.id ? "border-[#164FA3] bg-blue-50" : "border-gray-100 hover:bg-gray-50"} disabled:cursor-default`}
                  >
                    <Avatar name={c.person_name || c.phone_key} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-gray-900 truncate">{c.person_name || "Unnamed"}</div>
                      <div className="text-xs text-gray-500 font-mono" data-testid="uw-row-phone">{c.phone_key}</div>
                    </div>
                    {view === "followups"
                      ? <span className="text-[11px] font-semibold text-[#164FA3]" data-testid="uw-followup-when">Follow up {String(c.follow_up_date).slice(0, 10)}{c.follow_up_time ? ` · ${String(c.follow_up_time).slice(0, 5)}` : ""}</span>
                      : view === "pending"
                      ? (Number(c.attempts) > 0 && <span className="text-[10px] font-bold bg-[#FCB712] text-[#164FA3] px-2 py-0.5 rounded-full">RETRY ×{c.attempts}</span>)
                      : <span className="text-[11px] text-emerald-700 font-semibold">{c.call_status_name}{c.wrong_number_reason ? ` · ${unfilteredWrongReasonLabel(c.wrong_number_reason) || c.wrong_number_reason}` : ""}{c.call_status_name === "Phone Picked" && c.call_sentiment ? ` · ${phonePickedLabel(c.call_sentiment)}` : ""}</span>}
                  </button>
                  {view === "completed" && c.call_status_name === "Phone Picked" && (
                    <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-1">
                      <span className="text-[11px] text-gray-500">Phone Picked:</span>
                      <select value={["active", "opponent", "not_interested"].includes(c.call_sentiment) ? c.call_sentiment : ""} onChange={(e) => changePhonePicked(c.id, e.target.value)} data-testid="uw-picked-edit" aria-label="Change Phone Picked option"
                        className="text-xs border border-gray-200 rounded-md px-1.5 py-1 bg-white">
                        {!["active", "opponent", "not_interested"].includes(c.call_sentiment) && <option value="">{c.call_sentiment ? phonePickedLabel(c.call_sentiment) : "Select…"}</option>}
                        {PHONE_PICKED_OPTIONS.filter((o) => o.value !== "wrong_number").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  )}
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
                    {active.editCompleted ? "Editing completed call · Unfiltered" : "Calling · Unfiltered"}
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
                {!active.editCompleted && (
                <div className="text-right shrink-0">
                  <div className="text-xs uppercase tracking-wider text-blue-200">Duration</div>
                  <div className="text-2xl font-mono font-bold">{formatDurationHrMinSec(elapsed, "0 Sec")}</div>
                </div>)}
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
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Name</label>
                    <input value={edit.person_name} onChange={(e) => setEdit({ ...edit, person_name: e.target.value })} className={inputCls} aria-label="Name" data-testid="uw-edit-name" maxLength={100} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Phone Number</label>
                    <input value={edit.phone_number} onChange={(e) => setEdit({ ...edit, phone_number: e.target.value })} inputMode="tel" className={inputCls} aria-label="Phone Number" data-testid="uw-edit-phone" maxLength={20} />
                  </div>
                  <div className="sm:col-span-2" data-testid="uw-edit-designation">
                    <DesignationWingRows single rows={edit.drow || [{ designation_id: "", wing: "" }]} onChange={(rows) => setEdit({ ...edit, drow: rows })} designations={desigs} wingMaster={wingMaster} />
                  </div>
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
                <p className="text-[11px] text-gray-500 mt-3">The photo is changed from the picture above. Only the fields you change are saved; empty fields never clear existing data. Changes also update the linked Contact List record (never a new one).</p>
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
                          <span className="text-xs text-gray-500">{h.agent_name} · {h.status_name}{h.wrong_number_reason ? ` · ${unfilteredWrongReasonLabel(h.wrong_number_reason) || h.wrong_number_reason}` : ""}{h.sentiment ? ` · ${phonePickedLabel(h.sentiment)}` : ""}{h.follow_up_date ? ` · follow-up ${String(h.follow_up_date).slice(0, 10)}${h.follow_up_time ? ` ${String(h.follow_up_time).slice(0, 5)}` : ""}` : ""}</span>
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
              <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4"><Square size={16} /> {active.editCompleted ? "Edit Completed Call" : "Log Outcome"}</h3>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Status *</label>
                  <select value={form.status_id} onChange={(e) => setForm({ ...form, status_id: e.target.value, pp: "", sentiment: "", wrong_number_reason: "", follow_up_date: "", follow_up_time: "" })} className={inputCls} aria-label="Status">
                    <option value="">Select…</option>
                    {statuses.filter((s) => !UNFILTERED_HIDDEN_STATUSES.includes(s.name) && (!active.editCompleted || UNFILTERED_FINAL_STATUSES.includes(s.name))).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Phone Picked *</label>
                    <select value={form.pp} onChange={(e) => setForm({ ...form, pp: e.target.value, sentiment: "", wrong_number_reason: "" })} className={inputCls} aria-label="Phone Picked option" data-testid="uw-sentiment">
                      <option value="">Select…</option>
                      <option value="active">Active</option>
                      <option value="not_active">Not Active</option>
                    </select>
                  </div>
                )}
                {isPicked && form.pp === "not_active" && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Not Active - reason *</label>
                    <select value={form.sentiment} onChange={(e) => setForm({ ...form, sentiment: e.target.value, wrong_number_reason: "" })} className={inputCls} aria-label="Not Active reason" data-testid="uw-notactive">
                      <option value="">Select…</option>
                      {NOT_ACTIVE_REASONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                )}
                {isBusy && (
                  <div className="grid grid-cols-2 gap-3" data-testid="uw-followup-fields">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Follow-up Date</label>
                      <input type="date" value={form.follow_up_date} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}
                        onChange={(e) => setForm({ ...form, follow_up_date: e.target.value, follow_up_time: e.target.value ? form.follow_up_time : "" })} className={inputCls} aria-label="Follow-up Date" data-testid="uw-followup-date" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Follow-up Time</label>
                      <input type="time" value={form.follow_up_time} disabled={!form.follow_up_date} title={form.follow_up_date ? "" : "Pick a date first"}
                        onChange={(e) => setForm({ ...form, follow_up_time: e.target.value })} className={`${inputCls} disabled:opacity-50`} aria-label="Follow-up Time" data-testid="uw-followup-time" />
                    </div>
                    {form.follow_up_date && (
                      <button type="button" onClick={() => setForm({ ...form, follow_up_date: "", follow_up_time: "" })} className="col-span-2 text-left text-[11px] text-gray-500 hover:text-gray-800 underline">Remove follow-up</button>
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
                {active.editCompleted
                  ? <span className="text-[11px] text-gray-500">Editing a completed call updates the same record. It stays completed and is not a new call.</span>
                  : <button onClick={releaseNoLog} disabled={submitting} data-testid="uw-release" className="px-4 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-2"><X size={16} /> Release (no log)</button>}
                <button onClick={() => { setActive(null); setError(""); }} disabled={submitting} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={active.editCompleted ? saveCompleted : submit} disabled={submitting} data-testid="uw-save"
                  className="px-6 py-2.5 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center gap-2">
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {active.editCompleted ? "Save changes" : "Save & Next"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
