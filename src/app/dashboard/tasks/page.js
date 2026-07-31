"use client";

import { useEffect, useState, Fragment } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { isOversight } from "@/lib/permissions";
import { ClipboardList, Plus, Loader2, Calendar, AlertTriangle, CheckCircle2, Clock, X, Pencil, Search, ChevronRight, ChevronDown } from "lucide-react";
import SubtaskChecklist from "@/components/SubtaskChecklist";
import { formatDate } from "@/lib/dateFormat";
import PageHeader from "@/components/PageHeader";
import CollapsibleSection from "@/components/CollapsibleSection";
import ActionBar from "@/components/ActionBar";

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
  useEffect(() => { if (status === "unauthenticated") router.push("/login"); }, [status, router]);
  if (status !== "authenticated" || !session) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body canManage={isOversight(session)} />;
}

function Body({ canManage }) {
  const [data, setData] = useState({ tasks: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(canManage ? "all" : "mine");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [sort, setSort] = useState("newest");
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
    const r = await fetch(`/api/tasks?${p}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }
  async function updateStatus(id, newStatus) {
    await fetch(`/api/tasks/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }) });
    load();
  }

  const views = canManage
    ? [{ k: "all", l: "All Tasks" }, { k: "pending", l: "Pending" }, { k: "mine", l: "My Tasks" }]
    : [{ k: "mine", l: "My Tasks" }];
  const c = data.counts || {};
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
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
        <SumCard label="Overdue" value={c.overdue || 0} danger={Number(c.overdue) > 0} />
      </div>

      <div className="flex gap-2">
        {views.map((v) => (
          <button key={v.k} onClick={() => setView(v.k)} className={`px-4 py-2 rounded-xl text-sm font-medium ${view === v.k ? "bg-[#164FA3] text-white" : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"}`}>{v.l}</button>
        ))}
      </div>

      <CollapsibleSection title="Search & Filters">
      <div className="flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or description" className="flex-1 min-w-[180px] outline-none text-sm py-2" />
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
        ) : data.tasks.length === 0 ? (
          <div className="p-12 text-center text-gray-400"><ClipboardList size={36} className="mx-auto text-gray-300 mb-3" />No tasks.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600 w-12">S.No.</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Task</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Priority</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Assignee</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Assigned On</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Deadline</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.tasks.map((t, idx) => {
                const overdue = t.deadline && t.deadline.slice(0, 10) < today && t.status !== "completed";
                const next = STATUS_FLOW[STATUS_FLOW.indexOf(t.status) + 1];
                const hasSubs = (t.subtask_total || 0) > 0;
                const isOpen = expanded.has(t.id);
                const pct = hasSubs ? Math.round((t.subtask_done / t.subtask_total) * 100) : 0;
                const assignedOn = fmtAssignedOn(t.assigned_at || t.created_at);
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
                          {t.description && <div className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{t.description}</div>}
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
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {typeof assignedOn === "object" ? (
                        <><div className="font-medium text-gray-800">{assignedOn.date}</div><div className="text-gray-400">{assignedOn.time}</div></>
                      ) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-xs ${overdue ? "text-red-600 font-bold" : "text-gray-600"}`}>
                      {t.deadline ? formatDate(t.deadline) : "—"}{overdue ? " (overdue)" : ""}
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
                      <td colSpan={8} className="px-12 py-3">
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

      {showAdd && <AddTaskModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {editing && <AddTaskModal editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
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

function AddTaskModal({ onClose, onSaved, editing }) {
  const [form, setForm] = useState(editing ? {
    title: editing.title || "", description: editing.description || "",
    priority: editing.priority || "medium",
    deadline: editing.deadline ? editing.deadline.slice(0, 10) : "",
    assigned_to_user_id: editing.assigned_to_user_id || "",
    assigned_to_team_id: editing.assigned_to_team_id || "",
  } : { title: "", description: "", priority: "medium", deadline: "", assigned_to_user_id: "", assigned_to_team_id: "" });
  // Checklist builder — unlimited items. Keep ids on edit so completion state is
  // preserved; new items have id null.
  const [subtasks, setSubtasks] = useState(
    editing?.subtasks?.length ? editing.subtasks.map((s) => ({ id: s.id, title: s.title })) : [{ id: null, title: "" }]
  );
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users || [])).catch(() => {});
    fetch("/api/teams").then((r) => r.json()).then((d) => setTeams(d.teams || [])).catch(() => {});
  }, []);

  const setSub = (i, title) => setSubtasks((s) => s.map((x, j) => (j === i ? { ...x, title } : x)));
  const addSub = () => setSubtasks((s) => [...s, { id: null, title: "" }]);
  const removeSub = (i) => setSubtasks((s) => (s.length === 1 ? [{ id: null, title: "" }] : s.filter((_, j) => j !== i)));

  async function save() {
    setSaving(true);
    const url = editing ? `/api/tasks/${editing.id}` : "/api/tasks";
    const method = editing ? "PUT" : "POST";
    const cleanSubs = subtasks.map((s) => ({ id: s.id ?? null, title: s.title.trim() })).filter((s) => s.title);
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, subtasks: cleanSubs }) });
    if (r.ok) onSaved(); else setSaving(false);
  }
  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">{editing ? "Edit Task" : "Create Task"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <input className={inp} placeholder="Task title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea className={inp} rows={2} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

        {/* Sub-task builder — unlimited checklist items */}
        <div className="border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Sub Tasks (checklist)</div>
          {subtasks.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-md border border-gray-300 shrink-0" />
              <input
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]"
                placeholder={`Checklist item ${i + 1}`}
                value={s.title}
                onChange={(e) => setSub(i, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSub(); } }}
              />
              <button type="button" onClick={() => removeSub(i)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><X size={15} /></button>
            </div>
          ))}
          <button type="button" onClick={addSub} className="inline-flex items-center gap-1 text-sm font-semibold text-[#164FA3] hover:underline">
            <Plus size={14} /> Add Another Task
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <select className={inp} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <input type="date" className={inp} value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          <select className={inp} value={form.assigned_to_user_id} onChange={(e) => setForm({ ...form, assigned_to_user_id: e.target.value })}>
            <option value="">Assign to user…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
          <select className={inp} value={form.assigned_to_team_id} onChange={(e) => setForm({ ...form, assigned_to_team_id: e.target.value })}>
            <option value="">Assign to team…</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving || !form.title} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : (editing ? "Save" : "Create")}</button>
        </div>
      </div>
    </div>
  );
}
