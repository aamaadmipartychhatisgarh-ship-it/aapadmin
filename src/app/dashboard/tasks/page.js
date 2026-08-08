"use client";

import { useEffect, useState, useRef, Fragment } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { isOversight } from "@/lib/permissions";
import { useCallerPreview } from "@/lib/useCallerPreview";
import { ClipboardList, Plus, Loader2, Calendar, AlertTriangle, CheckCircle2, Clock, X, Pencil, Search, ChevronRight, ChevronDown, Users, Check } from "lucide-react";
import SubtaskChecklist from "@/components/SubtaskChecklist";
import { formatDate } from "@/lib/dateFormat";
import PageHeader from "@/components/PageHeader";
import CollapsibleSection from "@/components/CollapsibleSection";
import ActionBar from "@/components/ActionBar";
import { DURATION_PRESETS, DURATION_DAYS, addDays, daysBetween } from "@/lib/taskDuration";

const SHOW_COMPLETED_KEY = "tasks_show_completed";

function durationLabel(t) {
  if (!t.duration_preset && !t.duration_days) return "—";
  const preset = DURATION_PRESETS.find((p) => p.key === t.duration_preset);
  if (preset && preset.key !== "custom") return preset.label;
  return t.duration_days ? `${t.duration_days} day${t.duration_days === 1 ? "" : "s"}` : "—";
}
function completionPct(t) {
  if ((t.subtask_total || 0) > 0) return Math.round((t.subtask_done / t.subtask_total) * 100);
  if (t.status === "completed") return 100;
  if (t.status === "cancelled") return null;
  return 0;
}
function RemainingCell({ t, today }) {
  if (t.status === "completed" || t.status === "cancelled" || !t.deadline) return <span className="text-gray-300">—</span>;
  const rem = daysBetween(today, t.deadline);
  if (rem === null) return <span className="text-gray-300">—</span>;
  if (rem < 0) return <span className="text-red-600 font-bold">{Math.abs(rem)}d overdue</span>;
  if (rem === 0) return <span className="text-amber-600 font-semibold">Due today</span>;
  return <span className="text-gray-600">{rem}d left</span>;
}

const PRIORITY = {
  urgent: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-gray-100 text-gray-600",
};
const STATUS = {
  pending: "bg-gray-100 text-gray-600", in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700", cancelled: "bg-gray-100 text-gray-400",
};
const STATUS_FLOW = ["pending", "in_progress", "completed"];
const SORT_OPTIONS = [
  { k: "newest", l: "Newest Assigned" },
  { k: "oldest", l: "Oldest Assigned" },
  { k: "priority", l: "Priority" },
  { k: "deadline", l: "Deadline" },
  { k: "status", l: "Status" },
  { k: "title_az", l: "Title A–Z" },
  { k: "title_za", l: "Title Z–A" },
];

// "31/07/2026 • 05:15 PM" in the application timezone (Asia/Kolkata).
function fmtAssignedOn(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).format(d);
  return { date, time };
}

export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  // A Super Admin previewing a caller gets the caller's task view (My Tasks
  // only, no management actions) — matching what that caller sees on login.
  const { previewingCaller, viewAsCaller } = useCallerPreview(session);
  useEffect(() => { if (status === "unauthenticated") router.push("/login"); }, [status, router]);
  if (status !== "authenticated" || !session) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body canManage={isOversight(session) && !previewingCaller} previewingCaller={previewingCaller} viewAsCaller={viewAsCaller} />;
}

function Body({ canManage, previewingCaller, viewAsCaller }) {
  const [data, setData] = useState({ tasks: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(canManage ? "all" : "mine");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  // Transient success toast (e.g. after creating a task). Auto-dismisses.
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [sort, setSort] = useState("newest");
  const [showCompleted, setShowCompleted] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setShowCompleted(window.localStorage.getItem(SHOW_COMPLETED_KEY) === "1");
  }, []);
  const toggleShowCompleted = () => setShowCompleted((v) => {
    const next = !v;
    if (typeof window !== "undefined") window.localStorage.setItem(SHOW_COMPLETED_KEY, next ? "1" : "0");
    return next;
  });
  const [districts, setDistricts] = useState([]);
  const [users, setUsers] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpand = (id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Live-update a task's progress/status in place when its checklist changes.
  const onSubProgress = (taskId, done, total, status) => setData((d) => ({
    ...d,
    tasks: d.tasks.map((t) => (t.id === taskId ? { ...t, subtask_done: done, subtask_total: total, status } : t)),
  }));

  useEffect(() => {
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
    if (canManage) fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, search, statusFilter, priorityFilter, districtId, assignedTo, sort]);
  async function load() {
    setLoading(true);
    const p = new URLSearchParams({ view });
    if (search) p.set("search", search);
    if (statusFilter) p.set("status", statusFilter);
    if (priorityFilter) p.set("priority", priorityFilter);
    if (districtId) p.set("district_id", districtId);
    if (assignedTo) p.set("assigned_to", assignedTo);
    if (sort) p.set("sort", sort);
    // Always fetch fresh: no-store defeats the browser/proxy HTTP cache, and the
    // _ cache-buster makes each refetch a unique URL so a newly-created task
    // shows immediately instead of a stale cached list being returned.
    p.set("_", String(Date.now()));
    const r = await fetch(`/api/tasks?${p}`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
    setLoading(false);
  }
  async function updateStatus(id, newStatus) {
    await fetch(`/api/tasks/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }) });
    load();
  }

  const views = canManage
    ? [{ k: "all", l: "All" }, { k: "mine", l: "My Tasks" }, { k: "pending", l: "Pending" }, { k: "in_progress", l: "In Progress" }, { k: "completed", l: "Completed" }, { k: "overdue", l: "Overdue" }]
    : [{ k: "mine", l: "My Tasks" }];
  const c = data.counts || {};
  const today = new Date().toISOString().slice(0, 10);
  // Completed tasks are hidden by default (remembered per-browser); an
  // explicit "Completed" status filter always wins over the hide toggle.
  const visibleTasks = data.tasks.filter((t) => showCompleted || statusFilter === "completed" || t.status !== "completed");

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Success toast — confirms the task was actually saved by the backend. */}
      {notice && (
        <div className="fixed top-4 right-4 z-[60] flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 size={16} /> {notice}
        </div>
      )}
      {previewingCaller && viewAsCaller && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl p-3">
          Viewing <strong>{viewAsCaller.name}</strong>&apos;s tasks as Super Admin.
        </div>
      )}
      <PageHeader
        icon={ClipboardList}
        title="Tasks"
        description="Assign, track and complete organizational work."
        breadcrumb={[{ label: "Dashboard", href: canManage ? "/dashboard/admin" : "/dashboard" }, { label: "Task Management" }, { label: "Tasks" }]}
        actions={<ActionBar items={[canManage && { key: "add", label: "Create Task", icon: Plus, variant: "primary", onClick: () => setShowAdd(true) }]} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <SumCard label="Total" value={c.total || 0} accent />
        <SumCard label="Pending" value={c.pending || 0} />
        <SumCard label="In Progress" value={c.in_progress || 0} />
        <SumCard label="Completed" value={c.completed || 0} />
        <SumCard label="Due Today" value={c.due_today || 0} />
        <SumCard label="Overdue" value={c.overdue || 0} danger={Number(c.overdue) > 0} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {views.map((v) => (
          <button key={v.k} onClick={() => setView(v.k)} className={`px-4 py-2 rounded-xl text-sm font-medium ${view === v.k ? "bg-[#164FA3] text-white" : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"}`}>{v.l}</button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={showCompleted} onChange={toggleShowCompleted} className="rounded border-gray-300 text-[#164FA3] focus:ring-[#164FA3]" />
          Show Completed
        </label>
      </div>

      <CollapsibleSection title="Search & Filters">
      <div className="flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title" className="flex-1 min-w-[180px] outline-none text-sm py-2" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All districts</option>
          {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {canManage && view !== "mine" && (
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
            <option value="">Any assignee</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value)} title="Sort by" className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          {SORT_OPTIONS.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}
        </select>
      </div>
      </CollapsibleSection>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : visibleTasks.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <ClipboardList size={36} className="mx-auto text-gray-300 mb-3" />
            {data.tasks.length === 0 ? "No tasks." : "No tasks to show — completed tasks are hidden."}
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600 w-12">S.No.</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Task</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Priority</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Assignee</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Created By</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Duration</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Assigned On</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Due Date</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Remaining</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Completion</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((t, idx) => {
                const overdue = t.deadline && t.deadline.slice(0, 10) < today && t.status !== "completed";
                const next = STATUS_FLOW[STATUS_FLOW.indexOf(t.status) + 1];
                const hasSubs = (t.subtask_total || 0) > 0;
                const isOpen = expanded.has(t.id);
                const pct = hasSubs ? Math.round((t.subtask_done / t.subtask_total) * 100) : 0;
                const assignedOn = fmtAssignedOn(t.assigned_at || t.created_at);
                const completion = completionPct(t);
                return (
                  <Fragment key={t.id}>
                  <tr className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 font-medium tabular-nums">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        {hasSubs && (
                          <button onClick={() => toggleExpand(t.id)} className="mt-0.5 text-gray-400 hover:text-gray-700" aria-label="Toggle checklist">
                            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900">{t.title}</div>
                          {t.district_name && <div className="text-xs text-gray-400">{t.district_name}</div>}
                          {hasSubs && (
                            <div className="flex items-center gap-2 mt-1 max-w-[200px]">
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                              <span className="text-[11px] font-semibold text-gray-500 shrink-0">{t.subtask_done}/{t.subtask_total}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${PRIORITY[t.priority]}`}>{t.priority}</span></td>
                    <td className="px-4 py-3 text-gray-600">{t.assignee_name || t.team_name || "Unassigned"}</td>
                    <td className="px-4 py-3 text-gray-600">{t.created_by_name || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{durationLabel(t)}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {typeof assignedOn === "object" ? (
                        <><div className="font-medium text-gray-800">{assignedOn.date}</div><div className="text-gray-400">{assignedOn.time}</div></>
                      ) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-xs ${overdue ? "text-red-600 font-bold" : "text-gray-600"}`}>
                      {t.deadline ? formatDate(t.deadline) : "—"}{overdue ? " (overdue)" : ""}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap"><RemainingCell t={t} today={today} /></td>
                    <td className="px-4 py-3">
                      {completion === null ? <span className="text-gray-300 text-xs">—</span> : (
                        <div className="flex items-center gap-2 min-w-[70px]">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#164FA3] rounded-full" style={{ width: `${completion}%` }} /></div>
                          <span className="text-[11px] font-semibold text-gray-500 shrink-0">{completion}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3"><span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${STATUS[t.status]}`}>{t.status.replace("_", " ")}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {/* Tasks WITH a checklist are auto-completed by ticking items — no manual status button. */}
                        {hasSubs ? (
                          <button onClick={() => toggleExpand(t.id)} className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200">
                            {isOpen ? "Hide" : "Checklist"}
                          </button>
                        ) : next && t.status !== "completed" ? (
                          <button onClick={() => updateStatus(t.id, next)} className="text-xs px-2.5 py-1 rounded-lg bg-[#164FA3] text-white font-semibold hover:bg-blue-800">
                            Mark {next.replace("_", " ")}
                          </button>
                        ) : <span className="text-emerald-600 text-xs font-semibold inline-flex items-center gap-1"><CheckCircle2 size={14} /> Done</span>}
                        {canManage && (
                          <button onClick={() => setEditing(t)} title="Edit task" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg"><Pencil size={13} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {hasSubs && isOpen && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={12} className="px-12 py-3">
                        <SubtaskChecklist subtasks={t.subtasks} onProgress={(done, total, status) => onSubProgress(t.id, done, total, status)} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {showAdd && <AddTaskModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); setNotice("Task created successfully."); load(); }} />}
      {editing && <AddTaskModal editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice("Task updated successfully."); load(); }} />}
    </div>
  );
}

function SumCard({ label, value, accent, danger }) {
  return (
    <div className={`${accent ? "bg-[#164FA3] text-white" : danger ? "bg-red-50 border border-red-200" : "bg-white border border-gray-100"} rounded-xl p-4 shadow-sm`}>
      <div className={`text-2xl font-bold ${accent ? "" : danger ? "text-red-700" : "text-gray-900"}`}>{value}</div>
      <div className={`text-xs font-medium mt-1 ${accent ? "text-blue-200" : danger ? "text-red-500" : "text-gray-500"}`}>{label}</div>
    </div>
  );
}


// Stable, unique React keys for checklist rows. A subtask's DB `id` is null for
// new rows (and several new rows would collide on null), and the typed title
// must NEVER be used as a key — a key that changes as you type remounts the
// input and drops focus. So each row carries its own `_k` client key, assigned
// once at creation and never derived from its value. `_k` is render-only and is
// stripped out before the payload is built.
let subKeySeq = 0;
const newSub = (title = "", id = null) => ({ id, title, _k: `sk${++subKeySeq}` });

// Grouped section wrapper for the Create/Edit Task modal. MUST live at module
// scope (not inside AddTaskModal): a component defined inside the render body
// gets a new function identity on every keystroke, which makes React remount
// its whole subtree — including the inputs — so text fields would lose focus
// after a single character. A stable module-level identity keeps them mounted.
function Section({ icon: Icon, title, children }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">
        {Icon && <Icon size={13} />}{title}
      </div>
      {children}
    </div>
  );
}

// ===========================================================================
// Create / Edit Task
// ---------------------------------------------------------------------------
// One clean creation flow. The form is the single source of truth for task
// state; on submit it builds ONE payload object whose field names match the
// /api/tasks contract exactly (create → assigned_to_user_ids[], edit →
// assigned_to_user_id). The backend re-validates everything and performs the
// atomic create; this component never fakes success and never sticks on
// "Creating…". A task always starts as `pending` (set by the server).
// ===========================================================================
function AddTaskModal({ onClose, onSaved, editing }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState(() => {
    if (editing) {
      const start_date = editing.start_date ? editing.start_date.slice(0, 10) : todayStr;
      const duration_preset = editing.duration_preset || "custom";
      let duration_days;
      if (editing.duration_days != null) duration_days = editing.duration_days;
      else if (DURATION_DAYS[duration_preset] != null) duration_days = DURATION_DAYS[duration_preset];
      else if (editing.deadline) duration_days = daysBetween(start_date, editing.deadline);
      else duration_days = "";
      return {
        title: editing.title || "",
        priority: editing.priority || "medium",
        start_date, duration_preset, duration_days,
        // Multi-assign is an array of user-id strings. An existing task carries at
        // most one assignee, so edit seeds a single-element array.
        assigned_user_ids: editing.assigned_to_user_id ? [String(editing.assigned_to_user_id)] : [],
        assigned_to_team_id: editing.assigned_to_team_id ? String(editing.assigned_to_team_id) : "",
      };
    }
    return {
      title: "", priority: "medium",
      start_date: todayStr, duration_preset: "one_week", duration_days: DURATION_DAYS.one_week,
      assigned_user_ids: [], assigned_to_team_id: "",
    };
  });

  // Derived end date from start + duration (custom uses the typed day count).
  const durationDaysNum = form.duration_preset === "custom"
    ? (form.duration_days === "" ? null : Number(form.duration_days))
    : DURATION_DAYS[form.duration_preset];
  const endDate = form.start_date && durationDaysNum != null && !isNaN(durationDaysNum)
    ? addDays(form.start_date, durationDaysNum) : null;

  // Checklist builder — unlimited items. Existing items keep their id so their
  // completion state survives an edit; new rows have id null. Blank rows are
  // dropped at submit (never sent).
  const [subtasks, setSubtasks] = useState(
    editing?.subtasks?.length ? editing.subtasks.map((s) => newSub(s.title, s.id)) : [newSub()]
  );
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");        // top-level (backend / network) error
  const [fieldErr, setFieldErr] = useState({});  // per-field validation messages

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/users", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { users: [] })).catch(() => ({ users: [] })),
      fetch("/api/teams", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { teams: [] })).catch(() => ({ teams: [] })),
    ]).then(([u, t]) => {
      if (!alive) return;
      setUsers(u.users || []);
      setTeams(t.teams || []);
      setLoadingRefs(false);
    });
    return () => { alive = false; };
  }, []);

  // Update by _k (not index) so the row's identity — and its mounted input —
  // is never affected by edits to other rows.
  const setSub = (k, title) => setSubtasks((s) => s.map((x) => (x._k === k ? { ...x, title } : x)));
  const addSub = () => setSubtasks((s) => [...s, newSub()]);
  const removeSub = (k) => setSubtasks((s) => (s.length === 1 ? [newSub()] : s.filter((x) => x._k !== k)));

  const setUserIds = (ids) => setForm((f) => ({ ...f, assigned_user_ids: ids }));

  // ---- validation (mirrored on the backend; this only guards the UX) ----
  function validate() {
    const e = {};
    if (!form.title.trim()) e.title = "Task title is required.";
    if (!form.start_date) e.start_date = "Start date is required.";
    if (form.duration_preset === "custom") {
      const dd = Number(form.duration_days);
      if (!Number.isFinite(dd) || dd < 1) e.duration = "Enter a valid duration (at least 1 day).";
    }
    if (endDate && form.start_date && endDate < form.start_date) e.duration = "End date cannot be before the start date.";
    // An assignee is required: at least one user, or a whole team.
    if (form.assigned_user_ids.length === 0 && !form.assigned_to_team_id) {
      e.assignees = "Assign the task to at least one user or a team.";
    }
    return e;
  }

  async function save() {
    if (saving) return; // guard against double-submit
    const e = validate();
    setFieldErr(e);
    setError("");
    if (Object.keys(e).length) return; // block submit while invalid

    setSaving(true);

    // Build ONE payload whose keys match the /api/tasks contract exactly.
    // Dedup + stringify assignee ids so no duplicate/blank id is ever sent.
    const assignedToUserIds = [...new Set(form.assigned_user_ids.map((x) => String(x).trim()).filter(Boolean))];
    const cleanSubs = subtasks.map((s) => ({ id: s.id ?? null, title: s.title.trim() })).filter((s) => s.title);
    const base = {
      title: form.title.trim(),
      priority: form.priority,
      start_date: form.start_date,
      duration_preset: form.duration_preset,
      duration_days: durationDaysNum,
      deadline: endDate,
      assigned_to_team_id: form.assigned_to_team_id || "",
      subtasks: cleanSubs,
    };
    // Create fans out to every selected user (server makes one task each).
    // Edit keeps a single assignee, so it sends the first selected id.
    const payload = editing
      ? { ...base, assigned_to_user_id: assignedToUserIds[0] || "" }
      : { ...base, assigned_to_user_ids: assignedToUserIds };

    const url = editing ? `/api/tasks/${editing.id}` : "/api/tasks";
    const method = editing ? "PUT" : "POST";
    const failMsg = editing ? "Failed to save the task. Please try again." : "Failed to create the task. Please try again.";

    // Outcome is settled inside try/finally so the loading state is ALWAYS
    // cleared — a slow refresh or a hidden throw can never leave the button
    // stuck. A hard 45s abort surfaces a real timeout error (never fake success).
    let ok = false, errMsg = "";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    try {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (r.ok) {
        ok = true;
      } else {
        const data = await r.json().catch(() => ({}));
        // Surface the REAL backend message; map status codes to useful text.
        errMsg = data.message
          || ({ 401: "Your session has expired — please sign in again.",
                403: "You don't have permission to create tasks.",
                404: "The task could not be found.",
                409: "This task conflicts with an existing one.",
              }[r.status])
          || failMsg;
      }
    } catch (err) {
      errMsg = err?.name === "AbortError"
        ? "The request timed out — the task may not have been created. Please try again."
        : failMsg; // network failure / other fetch error
    } finally {
      clearTimeout(timeoutId);
      setSaving(false); // reset in EVERY case so the button never sticks
    }

    if (ok) {
      try { onSaved(); } catch { /* parent already handled; save is settled */ }
    } else {
      setError(errMsg || failMsg);
    }
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  const errInp = "border-red-300 focus:ring-red-200";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{editing ? "Edit Task" : "Create New Task"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6 overflow-y-auto">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2.5 text-sm flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}

          {/* Task Details */}
          <Section icon={ClipboardList} title="Task Details">
            <div>
              <input
                className={`${inp} ${fieldErr.title ? errInp : ""}`}
                placeholder="Task title *"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
              {fieldErr.title && <p className="text-xs text-red-600 mt-1">{fieldErr.title}</p>}
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1.5">Priority</div>
              <div className="grid grid-cols-4 gap-2">
                {["low", "medium", "high", "urgent"].map((p) => (
                  <button
                    key={p} type="button"
                    onClick={() => setForm({ ...form, priority: p })}
                    className={`text-xs font-semibold py-2 rounded-lg border capitalize transition
                      ${form.priority === p ? `${PRIORITY[p]} border-transparent ring-2 ring-[#164FA3]/30` : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          {/* Schedule */}
          <Section icon={Calendar} title="Schedule">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500">Start date *</label>
                <input type="date" className={`${inp} mt-1 ${fieldErr.start_date ? errInp : ""}`} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                {fieldErr.start_date && <p className="text-xs text-red-600 mt-1">{fieldErr.start_date}</p>}
              </div>
              <div>
                <label className="text-xs text-gray-500">Duration</label>
                <select
                  className={`${inp} mt-1`} value={form.duration_preset}
                  onChange={(e) => {
                    const preset = e.target.value;
                    setForm((f) => ({ ...f, duration_preset: preset, duration_days: DURATION_DAYS[preset] ?? f.duration_days }));
                  }}
                >
                  {DURATION_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">{form.duration_preset === "custom" ? "Number of days *" : "End date"}</label>
                {form.duration_preset === "custom" ? (
                  <input type="number" min={1} className={`${inp} mt-1 ${fieldErr.duration ? errInp : ""}`} placeholder="e.g. 5" value={form.duration_days} onChange={(e) => setForm({ ...form, duration_days: e.target.value })} />
                ) : (
                  <div className={`${inp} mt-1 bg-gray-50 text-gray-500 flex items-center`}>{endDate ? formatDate(endDate) : "—"}</div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">{form.duration_preset === "custom" && endDate ? `Ends ${formatDate(endDate)}` : ""}</span>
              {fieldErr.duration && <span className="text-red-600">{fieldErr.duration}</span>}
            </div>
          </Section>

          {/* Checklist */}
          <Section icon={CheckCircle2} title="Checklist (optional)">
            <div className="space-y-2">
              {subtasks.map((s, i) => (
                <div key={s._k} className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded border border-gray-300 shrink-0" />
                  <input
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]"
                    placeholder={`Checklist item ${i + 1}`}
                    value={s.title}
                    onChange={(e) => setSub(s._k, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSub(); } }}
                  />
                  <button type="button" onClick={() => removeSub(s._k)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><X size={15} /></button>
                </div>
              ))}
              <button type="button" onClick={addSub} className="inline-flex items-center gap-1 text-sm font-semibold text-[#164FA3] hover:underline">
                <Plus size={14} /> Add another subtask
              </button>
            </div>
          </Section>

          {/* Assignment */}
          <Section icon={Users} title="Assignment">
            <div>
              <label className="text-xs text-gray-500">Assign to team (optional)</label>
              <select className={`${inp} mt-1`} value={form.assigned_to_team_id} onChange={(e) => setForm({ ...form, assigned_to_team_id: e.target.value })}>
                <option value="">No team</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Assign to users {editing ? "" : "(select one or more)"}</label>
              <AssignUsers
                users={users}
                loading={loadingRefs}
                selected={form.assigned_user_ids}
                single={!!editing}
                onChange={setUserIds}
                error={fieldErr.assignees}
              />
              {fieldErr.assignees && <p className="text-xs text-red-600 mt-1">{fieldErr.assignees}</p>}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-60 text-white rounded-lg font-semibold inline-flex items-center gap-2">
            {saving && <Loader2 size={15} className="animate-spin" />}
            {saving ? (editing ? "Saving…" : "Creating…") : (editing ? "Save Changes" : "Create Task")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssignUsers — searchable, chip-based multi-select for task assignment.
// Selected users show as removable chips; the list below is filterable and
// supports Select all / Clear all. When `single` (edit mode) only one user can
// be chosen. Ids are kept as strings throughout so they match the API.
// ---------------------------------------------------------------------------
function AssignUsers({ users, selected, onChange, single, loading, error }) {
  const [q, setQ] = useState("");
  const roleLabel = (r) => String(r || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const byId = (id) => users.find((u) => String(u.id) === String(id));
  const allIds = users.map((u) => String(u.id));
  const allSelected = users.length > 0 && selected.length === users.length;

  const filtered = users.filter((u) => {
    const t = `${u.username} ${u.role || ""}`.toLowerCase();
    return t.includes(q.trim().toLowerCase());
  });

  const toggle = (id) => {
    id = String(id);
    if (single) { onChange(selected.includes(id) ? [] : [id]); return; }
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div className={`mt-1 border rounded-lg ${error ? "border-red-300" : "border-gray-200"}`}>
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 border-b border-gray-100">
          {selected.map((id) => {
            const u = byId(id);
            return (
              <span key={id} className="inline-flex items-center gap-1 bg-blue-50 text-[#164FA3] text-xs font-semibold pl-2 pr-1 py-1 rounded-full">
                {u?.username || `User ${id}`}
                <button type="button" onClick={() => toggle(id)} className="hover:bg-blue-100 rounded-full p-0.5"><X size={12} /></button>
              </span>
            );
          })}
        </div>
      )}

      {/* Search + bulk actions */}
      <div className="flex items-center gap-2 px-2 py-2 border-b border-gray-100">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          className="flex-1 text-sm outline-none bg-transparent"
          placeholder="Search users…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {!single && users.length > 0 && (
          <button type="button" onClick={() => onChange(allSelected ? [] : allIds)} className="text-[11px] font-semibold text-[#164FA3] hover:underline shrink-0">
            {allSelected ? "Clear all" : "Select all"}
          </button>
        )}
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-[11px] font-semibold text-gray-500 hover:underline shrink-0">Clear</button>
        )}
      </div>

      {/* User rows */}
      <div className="max-h-52 overflow-y-auto p-1">
        {loading ? (
          <div className="px-2 py-4 text-xs text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading users…</div>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-4 text-xs text-gray-400">{users.length === 0 ? "No users available." : "No users match your search."}</div>
        ) : filtered.map((u) => {
          const id = String(u.id);
          const on = selected.includes(id);
          return (
            <button
              key={u.id} type="button" onClick={() => toggle(id)}
              className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition ${on ? "bg-blue-50" : "hover:bg-gray-50"}`}
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? "bg-[#164FA3] border-[#164FA3]" : "border-gray-300"}`}>
                {on && <Check size={12} className="text-white" />}
              </span>
              {u.photo_url
                ? <img src={u.photo_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                : <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-[11px] font-bold flex items-center justify-center shrink-0">{(u.username || "?").slice(0, 1).toUpperCase()}</span>}
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-gray-800 truncate">{u.username}</span>
                <span className="block text-[11px] text-gray-400 truncate">{roleLabel(u.role)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
