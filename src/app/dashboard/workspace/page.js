"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Phone, MapPin, ChevronRight, Play, Square, X, ListChecks, Users, Loader2, CheckCircle2, History, Pencil, Calendar, Clock, Star, MessageSquare, Search, Plus, UserRound } from "lucide-react";
import { isAdmin, isOversight, isPressMedia, isSocialMedia } from "@/lib/permissions";
import Avatar from "@/components/Avatar";
import ProfilePhoto from "@/components/ProfilePhoto";
import { MultiSelect } from "@/components/MultiSelect";

// Friendly labels for who assigned a contact.
const ROLE_LABELS = { super_admin: "Super Admin", supervisor: "Supervisor", caller: "Caller" };
const roleLabel = (r) => ROLE_LABELS[r] || (r ? String(r).replace(/_/g, " ") : "");
// "30 Jul 2026 • 10:45 AM" in the application timezone (Asia/Kolkata).
function fmtAssigned(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return `${date} • ${time}`;
}

export default function WorkspacePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && isOversight(session)) {
      // The workspace is for callers only. Send oversight roles to their landing page.
      router.push(isAdmin(session) ? "/dashboard/admin" : "/dashboard/supervisor");
    } else if (status === "authenticated" && (isPressMedia(session) || isSocialMedia(session))) {
      router.push(isPressMedia(session) ? "/dashboard/media" : "/dashboard/social");
    }
  }, [status, session, router]);

  if (status === "loading" || !session || isOversight(session) || isPressMedia(session) || isSocialMedia(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <WorkspaceBody />;
}

function WorkspaceBody() {
  const [queue, setQueue] = useState({ assigned: [], assigned_total: 0, scheduled: [], pool_count: 0, home_district: null, active_lock: null });
  // Queue search / hierarchical geography + designation filters. Zone is not a
  // dropdown — it's the caller's own zone (shown in Your Queue) and auto-scopes
  // the Lok Sabha list.
  const [qSearch, setQSearch] = useState("");
  // Multi-select filters — each holds an array of selected ids ([] = All).
  const [qLokSabha, setQLokSabha] = useState([]);
  const [qDistrict, setQDistrict] = useState([]);
  const [qAssembly, setQAssembly] = useState([]);
  const [qDesignation, setQDesignation] = useState([]);
  const didMountQueue = useRef(false);
  const [active, setActive] = useState(null); // { ...contact, started_at }
  const [statuses, setStatuses] = useState([]);
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Bumped after each logged call so "Your Progress" refetches its outcome counts.
  const [progressKey, setProgressKey] = useState(0);

  const [form, setForm] = useState(initialForm());
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  // History of previous attempts for the active contact
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Quick complaint logging while on a call
  const [showComplaint, setShowComplaint] = useState(false);

  // Tasks pinned to the active contact
  const [contactTasks, setContactTasks] = useState([]);

  // Inline contact edit state. Callers can edit every detail of the contact
  // (like an admin) except its queue assignment — and they can't delete it.
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(initialEdit());
  const [editSaving, setEditSaving] = useState(false);
  // Cascading location options for the edit form (zone → lok sabha; district →
  // assembly). Block/Ward is a free-text field, not a cascade.
  const [editLokSabhas, setEditLokSabhas] = useState([]);
  const [editAssemblies, setEditAssemblies] = useState([]);

  useEffect(() => {
    // Apply this caller's standing assignment rules (reclaim stale + top up to
    // the daily quota), then load the freshly-filled queue. Failures are
    // non-fatal — the queue still loads.
    fetch("/api/workspace/topup", { method: "POST" }).catch(() => {}).finally(() => loadQueue());
    fetch("/api/statuses").then((r) => r.json()).then((d) => setStatuses(d.statuses || []));
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
    fetch("/api/locations?type=lok_sabha").then((r) => r.json()).then((d) => setLokSabhas(d.locations || []));
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
    fetch("/api/locations?type=assembly").then((r) => r.json()).then((d) => setAssemblies(d.locations || []));
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(sortDesignations(d.designations || [])));
  }, []);

  // Lok Sabha options follow the chosen zone (all lok sabhas when no zone set).
  useEffect(() => {
    const url = edit.zone_id ? `/api/locations?parent_id=${edit.zone_id}` : "/api/locations?type=lok_sabha";
    fetch(url).then((r) => r.json()).then((d) => setEditLokSabhas(d.locations || []));
  }, [edit.zone_id]);
  // Assembly options follow the chosen district.
  useEffect(() => {
    if (!edit.district_id) { setEditAssemblies([]); return; }
    fetch(`/api/locations?parent_id=${edit.district_id}`).then((r) => r.json()).then((d) => setEditAssemblies(d.locations || []));
  }, [edit.district_id]);

  // Restore active lock if the user reloaded mid-call
  useEffect(() => {
    if (queue.active_lock && !active) {
      const lockTime = new Date(queue.active_lock.locked_at).getTime();
      startActive(queue.active_lock, lockTime);
    }
  }, [queue.active_lock]);

  useEffect(() => {
    if (active) {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - active.started_at) / 1000));
      }, 1000);
      return () => clearInterval(timerRef.current);
    }
  }, [active]);

  // Tasks assigned on this contact — shown so the caller can act during the call.
  async function loadContactTasks(contactId) {
    const r = await fetch(`/api/tasks?contact_id=${contactId}`);
    if (r.ok) setContactTasks((await r.json()).tasks || []);
  }
  useEffect(() => {
    if (!active) { setContactTasks([]); return; }
    loadContactTasks(active.id);
  }, [active?.id]);

  async function setTaskStatus(taskId, newStatus) {
    await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (active) loadContactTasks(active.id);
  }

  // Whenever a contact becomes active, fetch its prior call history
  useEffect(() => {
    if (!active) { setHistory([]); setHistoryOpen(false); return; }
    setHistoryLoading(true);
    fetch(`/api/contacts/${active.id}/history`)
      .then((r) => r.json())
      .then((d) => {
        setHistory(d.history || []);
        // Auto-open if there are prior attempts so the caller knows context
        setHistoryOpen((d.history || []).length > 0);
      })
      .finally(() => setHistoryLoading(false));
    setEdit({
      person_name: active.person_name || "",
      phone_number: active.phone_number || "",
      address: active.address || "",
      designation_id: active.designation_id || "",
      zone_id: active.zone_id || "",
      lok_sabha_id: active.lok_sabha_id || "",
      district_id: active.district_id || "",
      assembly_id: active.assembly_id || "",
      ward_name: active.ward_name || "",
    });
    setEditing(false);
  }, [active?.id]);

  async function loadQueue() {
    setLoading(true);
    const params = new URLSearchParams();
    if (qSearch.trim()) params.set("search", qSearch.trim());
    if (qLokSabha.length) params.set("lok_sabha_id", qLokSabha.join(","));
    if (qDistrict.length) params.set("district_id", qDistrict.join(","));
    if (qAssembly.length) params.set("assembly_id", qAssembly.join(","));
    if (qDesignation.length) params.set("designation_id", qDesignation.join(","));
    const qs = params.toString();
    const r = await fetch(`/api/workspace/queue${qs ? `?${qs}` : ""}`);
    if (r.ok) setQueue(await r.json());
    setLoading(false);
  }

  // Re-load the queue when search / filters change (debounced for typing).
  useEffect(() => {
    if (!didMountQueue.current) { didMountQueue.current = true; return; }
    const t = setTimeout(() => loadQueue(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qSearch, qLokSabha.join(","), qDistrict.join(","), qAssembly.join(","), qDesignation.join(",")]);

  // Cascade pruning: when a parent's selection changes, drop any child selection
  // that no longer belongs to a selected parent ([] parent = "All" → no pruning).
  useEffect(() => {
    if (!qLokSabha.length) return;
    const ok = new Set(districts.filter((d) => qLokSabha.map(String).includes(String(d.parent_id))).map((d) => String(d.id)));
    setQDistrict((prev) => { const nx = prev.filter((id) => ok.has(String(id))); return nx.length === prev.length ? prev : nx; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLokSabha.join(",")]);
  useEffect(() => {
    if (!qDistrict.length && !qLokSabha.length) return;
    const dLS = {}; districts.forEach((d) => { dLS[d.id] = d.parent_id; });
    const ok = new Set(assemblies.filter((a) =>
      qDistrict.length ? qDistrict.map(String).includes(String(a.parent_id))
        : qLokSabha.map(String).includes(String(dLS[a.parent_id]))
    ).map((a) => String(a.id)));
    setQAssembly((prev) => { const nx = prev.filter((id) => ok.has(String(id))); return nx.length === prev.length ? prev : nx; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLokSabha.join(","), qDistrict.join(",")]);

  function startActive(contact, startedAtMs = Date.now()) {
    setActive({ ...contact, started_at: startedAtMs });
    setForm({ ...initialForm(), person_name: contact.person_name, phone_number: contact.phone_number });
    setElapsed(Math.floor((Date.now() - startedAtMs) / 1000));
    setMessage("");
    setError("");
  }

  async function claim(contact_id) {
    setMessage("");
    setError("");
    const r = await fetch("/api/workspace/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contact_id ? { contact_id } : {}),
    });
    const data = await r.json();
    if (!r.ok) {
      setError(data.message || "Could not claim a contact");
      return false;
    }
    startActive(data.contact);
    loadQueue();
    return true;
  }

  async function release() {
    await fetch("/api/workspace/release", { method: "POST" });
    setActive(null);
    setForm(initialForm());
    setElapsed(0);
    loadQueue();
  }

  async function submit() {
    if (!form.status_id) { setError("Please pick a status"); return; }
    if (form.follow_up_time && !form.follow_up_date) {
      setError("Please select a Follow-up Date before choosing a Follow-up Time.");
      return;
    }
    // Sentiment and follow-up date are both optional. A follow-up date, when
    // set, implies a follow-up is required (the two are no longer coupled to a
    // separate checkbox).
    setSubmitting(true);
    setError("");
    try {
      // Sentiment only applies to a connected ("Phone Picked") call — never save
      // a stale sentiment for any other status.
      const isPicked = statuses.find((s) => String(s.id) === String(form.status_id))?.name === "Phone Picked";
      const payload = {
        ...form,
        sentiment: isPicked ? (form.sentiment || null) : null,
        contact_id: active.id,
        designation_id: active.designation_id,
        zone_id: active.zone_id,
        lok_sabha_id: active.lok_sabha_id,
        district_id: active.district_id,
        assembly_id: active.assembly_id,
        ward_id: active.ward_id,
        booth_id: active.booth_id,
        address: active.address,
        duration_seconds: elapsed,
        is_follow_up_required: !!form.is_follow_up_required,
        is_vip: !!form.is_vip,
      };
      const r = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.message || "Failed to save"); return; }
      setProgressKey((k) => k + 1); // refresh outcome progress
      const savedDuration = elapsed;
      const scheduledFor = form.is_follow_up_required && form.follow_up_date ? form.follow_up_date : null;
      const followMsg = scheduledFor ? ` Reminder set for ${scheduledFor}${form.follow_up_time ? ` at ${form.follow_up_time}` : ""}.` : "";
      // Reset the active state, then immediately auto-claim the next contact.
      setActive(null);
      setForm(initialForm());
      setElapsed(0);
      const claimed = await claim();
      if (claimed) {
        setMessage(`Saved (${savedDuration}s).${followMsg} Next contact ready.`);
      } else {
        setMessage(`Saved (${savedDuration}s).${followMsg} No more contacts available.`);
        loadQueue();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function next() {
    setMessage("");
    claim();
  }

  async function saveEdit() {
    setEditSaving(true);
    setError("");
    try {
      const r = await fetch(`/api/contacts/${active.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit),
      });
      if (!r.ok) {
        const data = await r.json();
        setError(data.message || "Failed to update contact");
        return;
      }
      // Patch the active contact in place so the card reflects the new details.
      const districtName = districts.find((d) => String(d.id) === String(edit.district_id))?.name || (edit.district_id ? active.district_name : null);
      setActive({
        ...active,
        ...edit,
        district_name: districtName,
        ward_name: edit.ward_name || null,
        designation_id: edit.designation_id || null,
      });
      setForm({ ...form, person_name: edit.person_name, phone_number: edit.phone_number });
      setEditing(false);
      setMessage("Contact updated.");
    } finally {
      setEditSaving(false);
    }
  }

  // Persist the active contact's profile photo (ProfilePhoto already cropped +
  // compressed the blob). Uploads the file, then saves the URL on the linked
  // worker so it shows across every module. `blob === null` removes the photo.
  async function saveActivePhoto(blob) {
    if (!active) return null;
    let url = null;
    if (blob) {
      const fd = new FormData();
      fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      const up = await fetch("/api/uploads", { method: "POST", body: fd });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData.message || "Upload failed");
      url = upData.url;
    }
    const r = await fetch(`/api/contacts/${active.id}/photo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photo_url: url }),
    });
    if (!r.ok) throw new Error("Could not save the photo.");
    return url;
  }

  // Hierarchical filter options, cascaded from the location tree (parent_id).
  // The zone is the caller's own zone (from Your Queue), applied automatically.
  const callerZone = queue.zone_id;
  const lsZone = {}; lokSabhas.forEach((l) => { lsZone[l.id] = l.parent_id; });
  const distLS = {}; districts.forEach((d) => { distLS[d.id] = d.parent_id; });
  const eq = (a, b) => String(a) === String(b);
  const has = (arr, v) => arr.map(String).includes(String(v));
  const lokSabhaOptions = callerZone ? lokSabhas.filter((l) => eq(l.parent_id, callerZone)) : lokSabhas;
  const districtOptions = qLokSabha.length
    ? districts.filter((d) => has(qLokSabha, d.parent_id))
    : callerZone ? districts.filter((d) => eq(lsZone[d.parent_id], callerZone)) : districts;
  const assemblyOptions = qDistrict.length
    ? assemblies.filter((a) => has(qDistrict, a.parent_id))
    : qLokSabha.length ? assemblies.filter((a) => has(qLokSabha, distLS[a.parent_id]))
    : callerZone ? assemblies.filter((a) => eq(lsZone[distLS[a.parent_id]], callerZone)) : assemblies;

  // Designation options include a synthetic "No Designation" entry so it can be
  // selected/deselected like any other option in the multi-select.
  const designationOptions = [...designations.map((d) => ({ id: String(d.id), name: d.name })), { id: "none", name: "No Designation" }];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-300">
      {/* LEFT: queue */}
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-3 text-[#164FA3]">
            <ListChecks size={18} />
            <h2 className="font-bold">Your Queue</h2>
          </div>
          <div className="text-sm text-gray-600 mb-4">
            {queue.territory
              ? <>{queue.territory.type === "zone" ? "Zone" : "District"}: <span className="font-semibold text-gray-900">{queue.territory.name}</span></>
              : <span className="text-amber-600">No zone set. Ask an admin.</span>}
          </div>

          <button
            onClick={next}
            disabled={!!active}
            className="w-full bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2"
          >
            <Play size={18} /> Start Next Call
          </button>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="bg-blue-50 rounded-xl p-3">
              <div className="text-blue-900 font-bold text-2xl">{queue.assigned_total ?? queue.assigned.length}</div>
              <div className="text-blue-700 text-xs uppercase tracking-wide font-medium">Due Today</div>
            </div>
            <div className="bg-amber-50 rounded-xl p-3">
              <div className="text-amber-900 font-bold text-2xl">{queue.pool_count}</div>
              <div className="text-amber-700 text-xs uppercase tracking-wide font-medium">In Pool</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-sm text-gray-900 mb-3 flex items-center gap-2">
            <Users size={16} /> Assigned to You
          </h3>

          {/* Search + filters */}
          <div className="space-y-2 mb-3">
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={qSearch}
                onChange={(e) => setQSearch(e.target.value)}
                placeholder="Search name or number…"
                className="w-full bg-white border border-gray-200 h-9 rounded-lg pl-8 pr-8 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]"
              />
              {qSearch && (
                <button onClick={() => setQSearch("")} title="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-700">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MultiSelect options={lokSabhaOptions} value={qLokSabha} onChange={setQLokSabha} allLabel="All Lok Sabhas" />
              <MultiSelect options={districtOptions} value={qDistrict} onChange={setQDistrict} allLabel="All Districts" />
              <MultiSelect options={assemblyOptions} value={qAssembly} onChange={setQAssembly} allLabel="All Assemblies" />
              <MultiSelect options={designationOptions} value={qDesignation} onChange={setQDesignation} allLabel="All Designations" />
            </div>
          </div>

          {loading ? (
            <div className="text-gray-400 text-sm">Loading…</div>
          ) : queue.assigned.length === 0 ? (
            <div className="text-gray-400 text-sm">
              {qSearch || qLokSabha.length || qDistrict.length || qAssembly.length || qDesignation.length ? "No assigned contacts match your search/filters." : "Nothing due today. Click Start Next Call to pull from the pool."}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] text-gray-400">
                  Showing {queue.assigned.length}{(queue.assigned_total ?? 0) > queue.assigned.length ? ` of ${queue.assigned_total}` : ""}
                </div>
                {queue.assigned.some((c) => c.is_daily) && (
                  <div className="text-[11px] font-bold text-[#164FA3] bg-[#FCB712]/20 px-2 py-0.5 rounded-full">
                    {queue.assigned.filter((c) => c.is_daily).length} daily — do first
                  </div>
                )}
              </div>
            <ul className="space-y-2 max-h-[300px] overflow-y-auto">
              {queue.assigned.map((c) => (
                <li key={c.id}>
                  <button
                    disabled={!!active}
                    onClick={() => claim(c.id)}
                    className={`w-full text-left p-3 rounded-lg border disabled:opacity-60 flex items-center gap-2 ${c.is_daily ? "bg-amber-50 border-amber-300 hover:bg-amber-100" : "border-gray-100 hover:bg-blue-50 disabled:hover:bg-white"}`}
                  >
                    <Avatar name={c.person_name} src={c.photo_url} size={36} className="bg-[#164FA3]/10" textClassName="text-[#164FA3]" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 text-sm flex items-center gap-1 flex-wrap">
                        {c.is_daily ? <span className="text-[9px] font-bold uppercase bg-[#FCB712] text-[#164FA3] px-1.5 py-0.5 rounded">Daily</span> : null}
                        {c.person_name}
                        {c.is_vip ? <Star size={12} className="text-[#FCB712] fill-[#FCB712]" /> : null}
                        {c.attempts > 0 ? <span className="ml-1 text-[10px] font-bold text-gray-400">×{c.attempts}</span> : null}
                      </div>
                      <div className="text-xs text-gray-500">{c.phone_number} · {c.district_name || "—"}</div>
                      {c.assigned_by_name && (
                        <div className="mt-1 flex items-start gap-1 text-[11px] text-gray-400 leading-tight">
                          <UserRound size={12} className="shrink-0 mt-px" />
                          <span className="min-w-0">
                            Assigned by: <span className="text-gray-500 font-medium">{c.assigned_by_name}</span>
                            {c.assigned_by_role ? ` (${roleLabel(c.assigned_by_role)})` : ""}
                            {c.assigned_at ? <><br />{fmtAssigned(c.assigned_at)}</> : null}
                          </span>
                        </div>
                      )}
                    </div>
                    <ChevronRight size={16} className="text-gray-400" />
                  </button>
                </li>
              ))}
            </ul>
            </>
          )}
        </div>

        {queue.scheduled && queue.scheduled.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-sm text-gray-900 mb-3 flex items-center gap-2">
              <Calendar size={16} /> Scheduled Later
            </h3>
            <p className="text-[11px] text-gray-400 mb-2">Tap any contact to call back now — logging the call updates the reminder.</p>
            <ul className="space-y-2 max-h-[200px] overflow-y-auto">
              {queue.scheduled.slice(0, 20).map((c) => (
                <li key={c.id}>
                  <button
                    disabled={!!active}
                    onClick={() => claim(c.id)}
                    title="Call back now — reopens this contact so you can log the call and update the reminder"
                    className="w-full text-left p-3 rounded-lg border border-gray-100 hover:bg-blue-50 disabled:opacity-60 disabled:hover:bg-white"
                  >
                    <div className="font-medium text-gray-900 text-sm flex items-center gap-1">
                      {c.person_name}
                      {c.is_vip ? <Star size={12} className="text-[#FCB712] fill-[#FCB712]" /> : null}
                    </div>
                    <div className="text-xs text-gray-500">{c.phone_number} · {c.district_name || "—"}</div>
                    <div className="text-[11px] font-semibold text-[#164FA3] mt-1">Follow up on {c.follow_up_date?.slice(0, 10)}{c.follow_up_time ? ` at ${String(c.follow_up_time).slice(0, 5)}` : ""} · tap to call back</div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ProgressPanel refreshKey={progressKey} />
      </div>

      {/* RIGHT: active call */}
      <div className="lg:col-span-2 space-y-4">
        {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center gap-2"><CheckCircle2 size={18} />{message}</div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3">{error}</div>}

        {active && (
          <>
            {/* Contact information header (permanent while on a call) */}
            <div className="bg-[#164FA3] text-white rounded-2xl shadow-sm p-6">
              {!editing ? (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="shrink-0">
                      <ProfilePhoto
                        name={active.person_name}
                        src={active.photo_url}
                        size={84}
                        square
                        className="bg-white/15 border-2 border-white/25"
                        textClassName="text-white"
                        persist={saveActivePhoto}
                        onChange={(url) => {
                          // Update every on-page surface that shows this person's
                          // avatar (active card + Assigned-to-You list + lock).
                          setActive((a) => (a ? { ...a, photo_url: url } : a));
                          setQueue((q) => ({
                            ...q,
                            assigned: (q.assigned || []).map((c) => (c.id === active.id ? { ...c, photo_url: url } : c)),
                            active_lock: q.active_lock && q.active_lock.id === active.id ? { ...q.active_lock, photo_url: url } : q.active_lock,
                          }));
                        }}
                      />
                    </div>
                    <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wider text-blue-200 mb-1 flex items-center gap-2">
                      Calling
                      {history.length > 0 && <span className="bg-[#FCB712] text-[#164FA3] text-[10px] font-bold px-2 py-0.5 rounded-full">RETRY ×{history.length}</span>}
                    </div>
                    <h2 className="text-3xl font-bold">{active.person_name}</h2>
                    {active.designation_id && (
                      <div className="text-sm font-semibold text-[#FCB712] mt-1">
                        {designations.find((d) => String(d.id) === String(active.designation_id))?.name || ""}
                      </div>
                    )}
                    <a href={`tel:${active.phone_number}`} className="text-xl font-mono mt-1 inline-block hover:underline">{active.phone_number}</a>
                    {(active.district_name || active.ward_name) && (
                      <div className="flex items-center gap-1 mt-3 text-blue-200 text-sm">
                        <MapPin size={14} /> {[active.district_name, active.ward_name].filter(Boolean).join(" / ")}
                      </div>
                    )}
                    {active.address && <div className="text-sm text-blue-200 mt-1">{active.address}</div>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wider text-blue-200">Duration</div>
                    <div className="font-mono text-4xl font-bold tabular-nums">{fmtTime(elapsed)}</div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs uppercase tracking-wider text-blue-200 mb-2">Edit contact details</div>
                  <input
                    value={edit.person_name}
                    onChange={(e) => setEdit({ ...edit, person_name: e.target.value })}
                    placeholder="Name"
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-blue-200 text-sm outline-none focus:bg-white/20"
                  />
                  <input
                    value={edit.phone_number}
                    onChange={(e) => setEdit({ ...edit, phone_number: e.target.value })}
                    placeholder="Phone"
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-blue-200 text-sm font-mono outline-none focus:bg-white/20"
                  />
                  <input
                    value={edit.address}
                    onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                    placeholder="Address"
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-blue-200 text-sm outline-none focus:bg-white/20"
                  />
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-blue-200 mb-1">Designation</label>
                    <select
                      value={edit.designation_id || ""}
                      onChange={(e) => setEdit({ ...edit, designation_id: e.target.value })}
                      className={editSelectCls}
                    >
                      <option className="text-gray-900" value="">No designation</option>
                      {designations.map((d) => <option key={d.id} value={d.id} className="text-gray-900">{d.name}</option>)}
                    </select>
                  </div>

                  <div className="pt-1 border-t border-white/15">
                    <div className="text-[11px] uppercase tracking-wide text-blue-200 mb-2 mt-2">Location</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] uppercase tracking-wide text-blue-200 mb-1">Zone</label>
                        <select
                          value={edit.zone_id || ""}
                          onChange={(e) => setEdit({ ...edit, zone_id: e.target.value, lok_sabha_id: "" })}
                          className={editSelectCls}
                        >
                          <option className="text-gray-900" value="">No zone</option>
                          {zones.map((z) => <option key={z.id} value={z.id} className="text-gray-900">{z.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] uppercase tracking-wide text-blue-200 mb-1">Lok Sabha</label>
                        <select
                          value={edit.lok_sabha_id || ""}
                          onChange={(e) => setEdit({ ...edit, lok_sabha_id: e.target.value })}
                          className={editSelectCls}
                        >
                          <option className="text-gray-900" value="">No Lok Sabha</option>
                          {editLokSabhas.map((l) => <option key={l.id} value={l.id} className="text-gray-900">{l.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] uppercase tracking-wide text-blue-200 mb-1">District</label>
                        <select
                          value={edit.district_id || ""}
                          onChange={(e) => setEdit({ ...edit, district_id: e.target.value, assembly_id: "", ward_name: "" })}
                          className={editSelectCls}
                        >
                          <option className="text-gray-900" value="">No district</option>
                          {districts.map((d) => <option key={d.id} value={d.id} className="text-gray-900">{d.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] uppercase tracking-wide text-blue-200 mb-1">Assembly</label>
                        <select
                          value={edit.assembly_id || ""}
                          onChange={(e) => setEdit({ ...edit, assembly_id: e.target.value })}
                          disabled={!edit.district_id}
                          className={editSelectCls}
                        >
                          <option className="text-gray-900" value="">{edit.district_id ? "No assembly" : "Pick district first"}</option>
                          {editAssemblies.map((a) => <option key={a.id} value={a.id} className="text-gray-900">{a.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] uppercase tracking-wide text-blue-200 mb-1">Block (Ward)</label>
                        <input
                          type="text"
                          value={edit.ward_name}
                          onChange={(e) => setEdit({ ...edit, ward_name: e.target.value })}
                          placeholder="Type block / ward name"
                          className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-blue-200 text-sm outline-none focus:bg-white/20"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex gap-2 mt-6">
                {!editing ? (
                  <>
                    <button onClick={release} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                      <X size={16} /> Release (no log)
                    </button>
                    <button onClick={() => setEditing(true)} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                      <Pencil size={16} /> Edit details
                    </button>
                    <button onClick={() => setShowComplaint(true)} className="bg-[#FCB712] text-[#164FA3] font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                      <MessageSquare size={16} /> Log Complaint
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={saveEdit} disabled={editSaving} className="bg-[#FCB712] text-[#164FA3] font-bold px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                      {editSaving ? "Saving…" : "Save changes"}
                    </button>
                    <button onClick={() => setEditing(false)} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm">
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {/* Permanent Today's Task panel — always visible, reads from My Tasks */}
        <TodaysTaskPanel onLogComplaint={() => setShowComplaint(true)} />

        {active && (
          <>
            {/* Tasks assigned on this contact */}
            {contactTasks.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-200 p-4">
                <div className="flex items-center gap-2 text-emerald-700 mb-3">
                  <ListChecks size={16} />
                  <span className="font-bold text-sm">Assigned tasks for this contact ({contactTasks.length})</span>
                </div>
                <ul className="space-y-2">
                  {contactTasks.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-3 border border-gray-100 rounded-xl p-3">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 text-sm">
                          {t.title}
                          <span className={`ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            t.priority === "urgent" ? "bg-red-100 text-red-700" :
                            t.priority === "high" ? "bg-orange-100 text-orange-700" :
                            t.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                          }`}>{t.priority}</span>
                        </div>
                        {t.description && <div className="text-xs text-gray-500 mt-0.5">{t.description}</div>}
                        {t.deadline && <div className="text-[11px] text-gray-400 mt-0.5">Due {t.deadline.slice(0, 10)}</div>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {["pending", "in_progress", "completed"].map((s) => (
                          <button
                            key={s}
                            onClick={() => setTaskStatus(t.id, s)}
                            className={`text-[10px] font-semibold uppercase px-2 py-1 rounded-lg ${
                              t.status === s
                                ? s === "completed" ? "bg-emerald-600 text-white" : s === "in_progress" ? "bg-[#164FA3] text-white" : "bg-gray-600 text-white"
                                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                            }`}
                          >
                            {s.replace("_", " ")}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Previous attempts history */}
            {history.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-amber-200">
                <button
                  onClick={() => setHistoryOpen(!historyOpen)}
                  className="w-full p-4 flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-2 text-amber-700">
                    <History size={16} />
                    <span className="font-bold text-sm">Previous attempts ({history.length})</span>
                  </div>
                  <ChevronRight size={16} className={`text-gray-400 transition-transform ${historyOpen ? "rotate-90" : ""}`} />
                </button>
                {historyOpen && (
                  <div className="border-t border-amber-100 divide-y divide-gray-100 max-h-[280px] overflow-y-auto">
                    {historyLoading ? (
                      <div className="p-4 text-gray-400 text-sm"><Loader2 className="inline animate-spin" /></div>
                    ) : (
                      history.map((h) => (
                        <div key={h.id} className="p-4 text-sm">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-gray-900">
                              {new Date(h.called_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <span className="text-xs text-gray-500">{h.agent_name} · {h.status_name}</span>
                          </div>
                          {h.remarks && <div className="text-gray-600 italic">"{h.remarks}"</div>}
                          <div className="text-xs text-gray-400 mt-1">
                            {h.duration_seconds != null && <span>{fmtTime(h.duration_seconds)} talk</span>}
                            {h.sentiment && <span> · {h.sentiment}</span>}
                            {h.is_follow_up_required && h.follow_up_date && <span> · follow-up scheduled {h.follow_up_date.slice(0, 10)}{h.follow_up_time ? ` ${String(h.follow_up_time).slice(0, 5)}` : ""}</span>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Outcome form */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Square size={16} /> Log Outcome</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Sentiment only makes sense for a connected call, so it shows
                    only when the status is "Phone Picked". For every other
                    status the field is hidden and Status takes the full width. */}
                {(() => {
                  const isPicked = statuses.find((s) => String(s.id) === String(form.status_id))?.name === "Phone Picked";
                  return (
                    <>
                      <Field label="Status *" className={isPicked ? "" : "md:col-span-2"}>
                        <select
                          value={form.status_id}
                          onChange={(e) => {
                            const picked = statuses.find((s) => String(s.id) === String(e.target.value))?.name === "Phone Picked";
                            // Reset sentiment whenever the status is not Phone Picked.
                            setForm({ ...form, status_id: e.target.value, sentiment: picked ? form.sentiment : "" });
                          }}
                          className={inputCls}
                        >
                          <option value="">Select…</option>
                          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </Field>
                      {isPicked && (
                        <Field label="Sentiment">
                          <select value={form.sentiment} onChange={(e) => setForm({ ...form, sentiment: e.target.value })} className={inputCls}>
                            <option value="">None</option>
                            <option value="positive">Positive</option>
                            <option value="supporter">Supporter</option>
                            <option value="neutral">Neutral</option>
                            <option value="negative">Negative</option>
                            <option value="opponent">Opponent</option>
                            <option value="not_supporter">Not a Supporter</option>
                          </select>
                        </Field>
                      )}
                    </>
                  );
                })()}
                <div className="md:col-span-2">
                  <Field label="Remarks">
                    <textarea rows={3} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className={inputCls} placeholder="What did they say?" />
                  </Field>
                </div>
                <div className="md:col-span-2 flex flex-wrap items-end gap-6">
                  {/* Follow-up DATE picker */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Follow-up Date (optional)</label>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 border border-gray-200 rounded px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-[#164FA3]">
                        <Calendar size={15} className="text-gray-400 shrink-0" />
                        <input
                          type="date"
                          value={form.follow_up_date}
                          onChange={(e) => setForm({ ...form, follow_up_date: e.target.value, is_follow_up_required: !!e.target.value })}
                          className="text-sm outline-none bg-transparent"
                        />
                      </div>
                      {form.follow_up_date && (
                        <button type="button" onClick={() => setForm({ ...form, follow_up_date: "", follow_up_time: "", is_follow_up_required: false })} className="text-xs text-gray-400 hover:text-gray-700 underline">
                          clear
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">Sets a reminder; leave blank if none needed.</p>
                  </div>
                  {/* Follow-up TIME picker (hour / minute / AM-PM via the native time input) */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Follow-up Time (optional)</label>
                    <div className={`flex items-center gap-2 border border-gray-200 rounded px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-[#164FA3] ${!form.follow_up_date ? "opacity-50" : ""}`}>
                      <Clock size={15} className="text-gray-400 shrink-0" />
                      <input
                        type="time"
                        value={form.follow_up_time}
                        onChange={(e) => setForm({ ...form, follow_up_time: e.target.value })}
                        disabled={!form.follow_up_date}
                        title={form.follow_up_date ? "" : "Pick a date first"}
                        className="text-sm outline-none bg-transparent disabled:cursor-not-allowed"
                      />
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">Defaults to the day's reminder time if blank.</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 pb-1.5">
                    <input type="checkbox" checked={form.is_vip} onChange={(e) => setForm({ ...form, is_vip: e.target.checked })} />
                    VIP
                  </label>
                </div>
              </div>

              <div className="mt-6 flex gap-3 justify-end">
                <button onClick={submit} disabled={submitting} className="bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl">
                  {submitting ? "Saving…" : "Save & Next"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {showComplaint && (
        <ComplaintModal
          contact={active}
          districts={districts}
          onClose={() => setShowComplaint(false)}
          onSaved={() => { setShowComplaint(false); setMessage("Complaint logged."); }}
        />
      )}
    </div>
  );
}

// The caller's current assigned task, read from My Tasks. Shows today's pending
// task first, then today's in-progress, then the most recently assigned open
// task. Auto-refreshes so a supervisor-assigned task appears without a reload.
const PRIORITY_BADGE = {
  urgent: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-gray-100 text-gray-600",
};
function TodaysTaskPanel({ onLogComplaint }) {
  const [task, setTask] = useState(undefined); // undefined = loading, null = none
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/tasks?view=mine");
      if (!r.ok) { setTask(null); return; }
      const tasks = (await r.json()).tasks || [];
      const today = new Date().toISOString().slice(0, 10);
      const open = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
      const todays = open.filter((t) => t.deadline && t.deadline.slice(0, 10) === today);
      const featured =
        todays.find((t) => t.status === "pending") ||
        todays.find((t) => t.status === "in_progress") ||
        [...open].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] ||
        null;
      setTask(featured);
    } catch { setTask(null); }
  }
  useEffect(() => {
    load();
    const iv = setInterval(load, 25000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);

  async function setStatus(s) {
    if (!task) return;
    setBusy(true);
    await fetch(`/api/tasks/${task.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: s }) }).catch(() => {});
    await load();
    setBusy(false);
  }

  const today = new Date().toISOString().slice(0, 10);
  const deadlineLabel = (d) => {
    if (!d) return "No deadline";
    const day = d.slice(0, 10);
    return day === today ? "Today" : new Date(day).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-gray-900 flex items-center gap-2"><ListChecks size={16} className="text-[#164FA3]" /> Today's Task</h3>
        {task && <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${task.status === "in_progress" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{task.status.replace("_", " ")}</span>}
      </div>

      {task === undefined ? (
        <div className="text-gray-400 text-sm py-4 text-center"><Loader2 className="inline animate-spin" /></div>
      ) : task === null ? (
        <div className="text-center py-6">
          <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-2" />
          <div className="font-semibold text-gray-800">No Task Assigned Today</div>
          <p className="text-sm text-gray-500 mt-1">You&apos;re all caught up. New tasks assigned by your Supervisor will appear here automatically.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-lg font-bold text-gray-900">{task.title}</div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div><div className="text-gray-400 text-[11px] uppercase tracking-wide">Priority</div><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${PRIORITY_BADGE[task.priority] || "bg-gray-100 text-gray-600"}`}>{task.priority}</span></div>
            <div><div className="text-gray-400 text-[11px] uppercase tracking-wide">Deadline</div><div className="text-sm font-medium text-gray-800">{deadlineLabel(task.deadline)}</div></div>
            <div><div className="text-gray-400 text-[11px] uppercase tracking-wide">Assigned By</div><div className="text-sm font-medium text-gray-800">{task.created_by_name || "Supervisor"}</div></div>
            <div><div className="text-gray-400 text-[11px] uppercase tracking-wide">Created</div><div className="text-sm font-medium text-gray-800">{task.created_at ? new Date(task.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}</div></div>
          </div>
          {task.description && (
            <div>
              <div className="text-gray-400 text-[11px] uppercase tracking-wide mb-1">Description</div>
              <div className={`text-sm text-gray-700 whitespace-pre-wrap ${expanded ? "" : "line-clamp-5"}`}>{task.description}</div>
              {task.description.length > 160 && (
                <button onClick={() => setExpanded(!expanded)} className="text-xs font-semibold text-[#164FA3] mt-1">{expanded ? "Show less" : "Read More"}</button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <a href="/dashboard/tasks" className="text-xs font-semibold bg-[#164FA3] text-white px-3 py-1.5 rounded-lg hover:bg-blue-800">Open Task</a>
            {task.status === "pending" && <button onClick={() => setStatus("in_progress")} disabled={busy} className="text-xs font-semibold border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">Mark In Progress</button>}
            {task.status !== "completed" && <button onClick={() => setStatus("completed")} disabled={busy} className="text-xs font-semibold border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-50 disabled:opacity-50">Completed</button>}
          </div>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-gray-100 text-center">
        <button onClick={onLogComplaint} className="inline-flex items-center gap-2 text-sm font-semibold text-[#164FA3] hover:underline">
          <MessageSquare size={15} /> Log Complaint
        </button>
      </div>
    </div>
  );
}

// Today's calling progress grouped by call OUTCOME (not by date). Each row shows
// the status, a colored progress bar (count ÷ total), and the live count. Counts
// come from a single aggregated query and refresh whenever a call is logged
// (refreshKey bumps). Follows the caller's day in the application timezone.
const OUTCOME_ROWS = [
  { key: "connected", label: "Phone Picked", color: "#10B981" },
  { key: "no_answer", label: "Not Picked", color: "#3B82F6" },
  { key: "busy", label: "Busy", color: "#8B5CF6" },
  { key: "switched_off", label: "Switched Off", color: "#0EA5E9" },
  { key: "wrong_number", label: "Wrong Number", color: "#6B7280" },
  { key: "rejected", label: "Rude / Rejected", color: "#EF4444" },
  { key: "follow_up", label: "Follow-up", color: "#FCB712" },
];

function ProgressPanel({ refreshKey = 0 }) {
  const [data, setData] = useState({ total_calls: 0, outcomes: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/workspace/progress`)
      .then((r) => r.json())
      .then((d) => setData({ total_calls: d.total_calls || 0, outcomes: d.outcomes || {} }))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const total = Number(data.total_calls) || 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
          <History size={16} /> Your Progress
        </h3>
        <span className="text-xs text-gray-500">Today</span>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm">Loading…</div>
      ) : total === 0 ? (
        <div className="text-gray-400 text-sm py-2">No progress available for selected period.</div>
      ) : (
        <>
          <div className="text-sm font-semibold text-gray-900 mb-3">
            Total Calls : <span className="text-[#164FA3]">{total.toLocaleString()}</span>
          </div>
          <ul className="space-y-2.5">
            {OUTCOME_ROWS.map((row) => {
              const count = Number(data.outcomes[row.key]) || 0;
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <li key={row.key} className="text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-gray-600 text-xs font-medium">{row.label}</span>
                    <span className="font-semibold text-gray-900 text-xs">{count.toLocaleString()}</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-2.5 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: row.color }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="text-[11px] text-gray-400 mt-3">Completed contacts don't reappear — start your next call to resume where you left off.</p>
    </div>
  );
}

// Quick complaint capture — prefilled from the contact the caller is talking to.
const COMPLAINT_TYPES = { water: "Water", roads: "Roads", electricity: "Electricity", ration: "Ration", other: "Other" };

function ComplaintModal({ contact, districts, onClose, onSaved }) {
  const [form, setForm] = useState({
    citizen_name: contact?.person_name || "",
    citizen_phone: contact?.phone_number || "",
    type: "water",
    description: "",
    district_id: contact?.district_id || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError("");
    const r = await fetch("/api/complaints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (r.ok) { onSaved(); return; }
    const d = await r.json().catch(() => ({}));
    setError(d.message || "Failed to log complaint");
    setSaving(false);
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Log Complaint</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
        <input className={inp} placeholder="Citizen name *" value={form.citizen_name} onChange={(e) => setForm({ ...form, citizen_name: e.target.value })} />
        <input className={inp} placeholder="Phone" value={form.citizen_phone} onChange={(e) => setForm({ ...form, citizen_phone: e.target.value })} />
        <select className={inp} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {Object.entries(COMPLAINT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={inp} value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value })}>
          <option value="">District</option>
          {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <textarea className={inp} rows={3} placeholder="What is the complaint about?" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving || !form.citizen_name} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : "Log Complaint"}</button>
        </div>
      </div>
    </div>
  );
}

// Order designations by organizational level (State → Lok Sabha → District →
// Vidhan Sabha → Block → Ward → Booth → Member → Volunteer → others). Stable, so
// the party sub-order within a level (as returned by the API) is preserved.
function designationRank(name) {
  const n = (name || "").toLowerCase();
  if (/\bstate\b|rajya|pradesh/.test(n)) return 0;
  if (/loksabha|lok\s*sabha/.test(n)) return 1;
  if (/district|zila|jila/.test(n)) return 2;
  if (/vidhan\s*sabha|vidhansabha|vidhansbha/.test(n)) return 3;
  if (/block/.test(n)) return 4;
  if (/ward/.test(n)) return 5;
  if (/booth/.test(n)) return 6;
  if (/member/.test(n)) return 7;
  if (/volunteer|karyakarta/.test(n)) return 8;
  return 9;
}
function sortDesignations(list) {
  return [...list].sort((a, b) => designationRank(a.name) - designationRank(b.name));
}

function initialForm() {
  return {
    person_name: "",
    phone_number: "",
    status_id: "",
    sentiment: "",
    remarks: "",
    is_follow_up_required: false,
    follow_up_date: "",
    follow_up_time: "",
    is_vip: false,
  };
}

// Blank state for the inline contact editor — every detail a caller may change.
function initialEdit() {
  return {
    person_name: "", phone_number: "", address: "", designation_id: "",
    zone_id: "", lok_sabha_id: "", district_id: "", assembly_id: "", ward_name: "",
  };
}

// Shared styling for the on-call edit form's selects (dark card, light popup).
const editSelectCls = "w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm outline-none focus:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed";

function fmtTime(s) {
  if (s == null) return "—";
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

const inputCls = "w-full bg-gray-50 border border-gray-200 text-gray-900 h-10 rounded-lg px-3 focus:ring-2 focus:ring-[#FCB712] outline-none";

function Field({ label, children, className = "" }) {
  return (
    <div className={className}>
      <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}
