"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { isOversight } from "@/lib/permissions";
import { ClipboardList, Plus, Loader2, Calendar, AlertTriangle, CheckCircle2, Clock, X, Pencil } from "lucide-react";

const PRIORITY = {
  urgent: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700", low: "bg-gray-100 text-gray-600",
};
const STATUS = {
  pending: "bg-gray-100 text-gray-600", in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700", cancelled: "bg-gray-100 text-gray-400",
};
const STATUS_FLOW = ["pending", "in_progress", "completed"];

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

  useEffect(() => { load(); }, [view]);
  async function load() {
    setLoading(true);
    const r = await fetch(`/api/tasks?view=${view}`);
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
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Tasks</h1>
          <p className="text-gray-500 mt-2 font-medium">Assign, track and complete organizational work.</p>
        </div>
        {canManage && (
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-md">
            <Plus size={16} /> Create Task
          </button>
        )}
      </div>

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

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : data.tasks.length === 0 ? (
          <div className="p-12 text-center text-gray-400"><ClipboardList size={36} className="mx-auto text-gray-300 mb-3" />No tasks.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">Task</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Priority</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Assignee</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Deadline</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.tasks.map((t) => {
                const overdue = t.deadline && t.deadline.slice(0, 10) < today && t.status !== "completed";
                const next = STATUS_FLOW[STATUS_FLOW.indexOf(t.status) + 1];
                return (
                  <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{t.title}</div>
                      {t.district_name && <div className="text-xs text-gray-400">{t.district_name}</div>}
                    </td>
                    <td className="px-4 py-3"><span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${PRIORITY[t.priority]}`}>{t.priority}</span></td>
                    <td className="px-4 py-3 text-gray-600">{t.assignee_name || t.team_name || "Unassigned"}</td>
                    <td className={`px-4 py-3 text-xs ${overdue ? "text-red-600 font-bold" : "text-gray-600"}`}>
                      {t.deadline ? t.deadline.slice(0, 10) : "—"}{overdue ? " (overdue)" : ""}
                    </td>
                    <td className="px-4 py-3"><span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${STATUS[t.status]}`}>{t.status.replace("_", " ")}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {next && t.status !== "completed" ? (
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
                );
              })}
            </tbody>
          </table>
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
    district_id: editing.district_id || "",
  } : { title: "", description: "", priority: "medium", deadline: "", assigned_to_user_id: "", district_id: "" });
  const [users, setUsers] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users || [])).catch(() => {});
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
  }, []);

  async function save() {
    setSaving(true);
    const url = editing ? `/api/tasks/${editing.id}` : "/api/tasks";
    const method = editing ? "PUT" : "POST";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) onSaved(); else setSaving(false);
  }
  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">{editing ? "Edit Task" : "Create Task"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <input className={inp} placeholder="Task title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea className={inp} rows={2} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <select className={inp} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <input type="date" className={inp} value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          <select className={inp} value={form.assigned_to_user_id} onChange={(e) => setForm({ ...form, assigned_to_user_id: e.target.value })}>
            <option value="">Assign to user…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
          <select className={inp} value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value })}>
            <option value="">District (optional)</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
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
