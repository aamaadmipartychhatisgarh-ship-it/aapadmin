"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Phone, MapPin, ChevronRight, Play, Square, X, ListChecks, Users, Loader2, CheckCircle2, History, Pencil, Calendar, Star, MessageSquare } from "lucide-react";
import { isAdmin, isOversight, isPressMedia, isSocialMedia } from "@/lib/permissions";

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
  const [queue, setQueue] = useState({ assigned: [], scheduled: [], pool_count: 0, home_district: null, active_lock: null });
  const [active, setActive] = useState(null); // { ...contact, started_at }
  const [statuses, setStatuses] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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

  // Inline contact edit state
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ person_name: "", phone_number: "", address: "", district_id: "", designation_id: "" });
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    loadQueue();
    fetch("/api/statuses").then((r) => r.json()).then((d) => setStatuses(d.statuses || []));
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || []));
  }, []);

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
      district_id: active.district_id || "",
      designation_id: active.designation_id || "",
    });
    setEditing(false);
  }, [active?.id]);

  async function loadQueue() {
    setLoading(true);
    const r = await fetch("/api/workspace/queue");
    if (r.ok) setQueue(await r.json());
    setLoading(false);
  }

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
    if (form.is_follow_up_required && !form.follow_up_date) {
      setError("Pick a follow-up date or uncheck Follow-up required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        ...form,
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
      const savedDuration = elapsed;
      // Reset the active state, then immediately auto-claim the next contact.
      setActive(null);
      setForm(initialForm());
      setElapsed(0);
      const claimed = await claim();
      if (claimed) {
        setMessage(`Saved (${savedDuration}s). Next contact ready.`);
      } else {
        setMessage(`Saved (${savedDuration}s). No more contacts available.`);
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
      // Patch the active contact in place
      const districtName = districts.find((d) => String(d.id) === String(edit.district_id))?.name || active.district_name;
      setActive({ ...active, ...edit, district_name: districtName, designation_id: edit.designation_id || null });
      setForm({ ...form, person_name: edit.person_name, phone_number: edit.phone_number });
      setEditing(false);
      setMessage("Contact updated.");
    } finally {
      setEditSaving(false);
    }
  }

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
            {queue.home_district
              ? <>District: <span className="font-semibold text-gray-900">{queue.home_district.name}</span></>
              : <span className="text-amber-600">No home district set. Ask an admin.</span>}
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
              <div className="text-blue-900 font-bold text-2xl">{queue.assigned.length}</div>
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
          {loading ? (
            <div className="text-gray-400 text-sm">Loading…</div>
          ) : queue.assigned.length === 0 ? (
            <div className="text-gray-400 text-sm">Nothing due today. Click Start Next Call to pull from the pool.</div>
          ) : (
            <ul className="space-y-2 max-h-[300px] overflow-y-auto">
              {queue.assigned.slice(0, 50).map((c) => (
                <li key={c.id}>
                  <button
                    disabled={!!active}
                    onClick={() => claim(c.id)}
                    className="w-full text-left p-3 rounded-lg hover:bg-blue-50 border border-gray-100 disabled:opacity-60 disabled:hover:bg-white flex items-center gap-2"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 text-sm flex items-center gap-1">
                        {c.person_name}
                        {c.is_vip ? <Star size={12} className="text-[#FCB712] fill-[#FCB712]" /> : null}
                        {c.attempts > 0 ? <span className="ml-1 text-[10px] font-bold text-gray-400">×{c.attempts}</span> : null}
                      </div>
                      <div className="text-xs text-gray-500">{c.phone_number} · {c.district_name || "—"}</div>
                    </div>
                    <ChevronRight size={16} className="text-gray-400" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {queue.scheduled && queue.scheduled.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-sm text-gray-900 mb-3 flex items-center gap-2">
              <Calendar size={16} /> Scheduled Later
            </h3>
            <ul className="space-y-2 max-h-[200px] overflow-y-auto">
              {queue.scheduled.slice(0, 20).map((c) => (
                <li key={c.id} className="p-3 rounded-lg border border-gray-100">
                  <div className="font-medium text-gray-900 text-sm flex items-center gap-1">
                    {c.person_name}
                    {c.is_vip ? <Star size={12} className="text-[#FCB712] fill-[#FCB712]" /> : null}
                  </div>
                  <div className="text-xs text-gray-500">{c.phone_number} · {c.district_name || "—"}</div>
                  <div className="text-[11px] font-semibold text-[#164FA3] mt-1">Follow up on {c.follow_up_date?.slice(0, 10)}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* RIGHT: active call */}
      <div className="lg:col-span-2 space-y-4">
        {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center gap-2"><CheckCircle2 size={18} />{message}</div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3">{error}</div>}

        {!active ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <Phone size={48} className="text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Ready when you are</h2>
            <p className="text-gray-500">Click <strong>Start Next Call</strong> to claim a contact and start the timer.</p>
            <button onClick={() => setShowComplaint(true)} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#164FA3] border border-blue-200 hover:bg-blue-50 px-4 py-2 rounded-xl">
              <MessageSquare size={16} /> Log Complaint
            </button>
          </div>
        ) : (
          <>
            {/* Contact card */}
            <div className="bg-[#164FA3] text-white rounded-2xl shadow-sm p-6">
              {!editing ? (
                <div className="flex items-start justify-between">
                  <div>
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
                  <select
                    value={edit.designation_id || ""}
                    onChange={(e) => setEdit({ ...edit, designation_id: e.target.value })}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm outline-none focus:bg-white/20"
                  >
                    <option className="text-gray-900" value="">No designation</option>
                    {designations.map((d) => <option key={d.id} value={d.id} className="text-gray-900">{d.name}</option>)}
                  </select>
                  <select
                    value={edit.district_id || ""}
                    onChange={(e) => setEdit({ ...edit, district_id: e.target.value })}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm outline-none focus:bg-white/20"
                  >
                    <option className="text-gray-900" value="">No district</option>
                    {districts.map((d) => <option key={d.id} value={d.id} className="text-gray-900">{d.name}</option>)}
                  </select>
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
                            {h.is_follow_up_required && h.follow_up_date && <span> · follow-up scheduled {h.follow_up_date.slice(0, 10)}</span>}
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
                <Field label="Status *">
                  <select value={form.status_id} onChange={(e) => setForm({ ...form, status_id: e.target.value })} className={inputCls}>
                    <option value="">Select…</option>
                    {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Sentiment">
                  <select value={form.sentiment} onChange={(e) => setForm({ ...form, sentiment: e.target.value })} className={inputCls}>
                    <option value="">—</option>
                    <option value="positive">Positive</option>
                    <option value="supporter">Supporter</option>
                    <option value="neutral">Neutral</option>
                    <option value="negative">Negative</option>
                    <option value="opponent">Opponent</option>
                  </select>
                </Field>
                <div className="md:col-span-2">
                  <Field label="Remarks">
                    <textarea rows={3} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className={inputCls} placeholder="What did they say?" />
                  </Field>
                </div>
                <div className="md:col-span-2 flex flex-wrap items-center gap-6">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input type="checkbox" checked={form.is_follow_up_required} onChange={(e) => setForm({ ...form, is_follow_up_required: e.target.checked })} />
                    Follow-up required
                  </label>
                  {form.is_follow_up_required && (
                    <input type="date" value={form.follow_up_date} onChange={(e) => setForm({ ...form, follow_up_date: e.target.value })} className="border border-gray-200 rounded px-3 py-1.5 text-sm" />
                  )}
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
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

function initialForm() {
  return {
    person_name: "",
    phone_number: "",
    status_id: "",
    sentiment: "",
    remarks: "",
    is_follow_up_required: false,
    follow_up_date: "",
    is_vip: false,
  };
}

function fmtTime(s) {
  if (s == null) return "—";
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

const inputCls = "w-full bg-gray-50 border border-gray-200 text-gray-900 h-10 rounded-lg px-3 focus:ring-2 focus:ring-[#FCB712] outline-none";

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}
