"use client";

import { useMemo, useState } from "react";
import { X, Loader2, ClipboardPaste, CheckCircle2, AlertTriangle, XCircle, Eye, Users as UsersIcon } from "lucide-react";
import { parsePastedTasks, sectionsToTasks, summarize } from "@/lib/pasteTaskParser";

// Super Admin → Task Assignment → "Paste Tasks". Paste many users and their
// tasks; the parser groups them by user (matched against the REAL user list),
// shows a preview with per-user resolution for any ambiguous / unknown name, and
// creates every task in ONE atomic backend request. No task is created until the
// admin explicitly clicks Create, and the batch is all-or-nothing.
const PRIORITIES = [
  { v: "low", l: "Low" }, { v: "medium", l: "Normal" }, { v: "high", l: "High" }, { v: "urgent", l: "Urgent" },
];

const EXAMPLE = `Aakash Kumar
Call 20 contacts
Update contact details
Follow up with pending users

Rahul Sharma
1. Call assigned contacts
2. Verify contact details

Priya Singh:
- Call booth workers
- Update worker information`;

export default function PasteTaskModal({ users = [], onClose, onCreated }) {
  const [text, setText] = useState("");
  const [sections, setSections] = useState(null); // null = not previewed yet
  const [priority, setPriority] = useState("medium");
  const [deadline, setDeadline] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [idemKey, setIdemKey] = useState("");

  // Distinct, sorted user options for resolving an ambiguous / unknown name.
  const userOptions = useMemo(
    () => (users || []).map((u) => ({
      id: String(u.id),
      label: `${u.username}${u.home_district_name ? ` · ${u.home_district_name}` : ""}${u.role_label ? ` · ${u.role_label}` : ""} (#${u.id})`,
    })),
    [users]
  );
  const userById = useMemo(() => new Map(userOptions.map((o) => [o.id, o])), [userOptions]);

  function preview() {
    setError("");
    const { sections: secs } = parsePastedTasks(text, users);
    setSections(secs);
    // A fresh idempotency key per preview → a retry of the SAME batch is deduped,
    // but editing + re-previewing produces a new key.
    setIdemKey(`paste_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  }

  // Manually resolve one section to a chosen user id (for ambiguous / unknown).
  function resolveSection(key, userId) {
    setSections((prev) => prev.map((s) => s.key === key
      ? (userId ? { ...s, userId: String(userId), status: "ok" } : { ...s, userId: null, status: s.candidateIds?.length ? "ambiguous" : "notfound" })
      : s));
  }

  const summary = sections ? summarize(sections) : { users: 0, tasks: 0, ready: 0, errors: 0 };
  const canCreate = !!sections && summary.errors === 0 && summary.ready > 0 && !creating;

  async function createTasks() {
    if (!canCreate) return;
    setCreating(true);
    setError("");
    try {
      const tasks = sectionsToTasks(sections);
      const res = await fetch("/api/tasks/bulk-paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks,
          common: { priority, deadline: deadline || null },
          idempotency_key: idemKey,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not create the tasks.");
      onCreated?.({ created: data.created ?? tasks.length, users: data.users, duplicate: !!data.duplicate });
    } catch (e) {
      setError(e?.message || "Could not create the tasks.");
      // A new key so a genuine retry after a real error isn't blocked as a dup.
      setIdemKey(`paste_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
    } finally {
      setCreating(false);
    }
  }

  const StatusCell = ({ s }) => {
    if (s.status === "ok") return <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-semibold"><CheckCircle2 size={13} /> Ready</span>;
    if (s.status === "ambiguous") return <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-semibold"><AlertTriangle size={13} /> Multiple users</span>;
    if (s.status === "no_user") return <span className="inline-flex items-center gap-1 text-red-600 text-xs font-semibold"><XCircle size={13} /> No user above</span>;
    return <span className="inline-flex items-center gap-1 text-red-600 text-xs font-semibold"><XCircle size={13} /> User not found</span>;
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onMouseDown={(e) => { if (e.target === e.currentTarget && !creating) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <ClipboardPaste size={18} className="text-[#164FA3]" />
            <h3 className="font-bold text-gray-900">Paste Tasks</h3>
          </div>
          <button onClick={() => !creating && onClose()} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-500">
            Paste multiple users and their tasks below. The system detects each user, separates their tasks, and assigns each task to the correct user. Nothing is created until you review the preview and click Create.
          </p>

          {/* Input */}
          <div>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setSections(null); }}
              rows={9}
              placeholder={`Paste users and tasks here…\n\n${EXAMPLE}`}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-[#164FA3]/30 whitespace-pre"
            />
          </div>

          {/* Common fields applied to every pasted task */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold text-gray-500">Priority (all)
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 block h-9 px-2.5 rounded-lg border border-gray-200 text-sm bg-white">
                {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-500">Due date (all, optional)
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1 block h-9 px-2.5 rounded-lg border border-gray-200 text-sm bg-white" />
            </label>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => { if (!creating) onClose(); }} className="px-4 h-9 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={preview} disabled={!text.trim() || creating} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm border border-[#164FA3] text-[#164FA3] hover:bg-blue-50 disabled:opacity-40">
                <Eye size={15} /> Preview Tasks
              </button>
            </div>
          </div>

          {/* Preview */}
          {sections && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-2.5 py-1 text-gray-700"><UsersIcon size={12} /> Users detected: <strong>{summary.users}</strong></span>
                <span className="bg-gray-100 rounded-full px-2.5 py-1 text-gray-700">Tasks detected: <strong>{summary.tasks}</strong></span>
                <span className="bg-emerald-50 text-emerald-700 rounded-full px-2.5 py-1">Ready: <strong>{summary.ready}</strong></span>
                <span className={`rounded-full px-2.5 py-1 ${summary.errors ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-500"}`}>Errors: <strong>{summary.errors}</strong></span>
              </div>

              {sections.length === 0 ? (
                <div className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg px-3 py-4 text-center">No users/tasks detected. Put each user on their own line, followed by their task lines.</div>
              ) : (
                <div className="border border-gray-100 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left sticky top-0"><tr>
                      <th className="px-3 py-2 font-semibold text-gray-600 w-8">#</th>
                      <th className="px-3 py-2 font-semibold text-gray-600">User</th>
                      <th className="px-3 py-2 font-semibold text-gray-600">Task</th>
                      <th className="px-3 py-2 font-semibold text-gray-600">Status</th>
                    </tr></thead>
                    <tbody>
                      {(() => {
                        let n = 0;
                        return sections.map((s) => s.tasks.map((task, ti) => {
                          n += 1;
                          return (
                            <tr key={`${s.key}-${ti}`} className={`border-t border-gray-100 ${s.status !== "ok" ? "bg-red-50/40" : ""}`}>
                              <td className="px-3 py-1.5 text-gray-400 tabular-nums">{n}</td>
                              <td className="px-3 py-1.5">
                                {ti === 0 ? (
                                  s.status === "ok" ? (
                                    <span className="font-medium text-gray-900">{userById.get(String(s.userId))?.label?.split(" · ")[0] || s.name}</span>
                                  ) : (
                                    <select value={s.userId || ""} onChange={(e) => resolveSection(s.key, e.target.value)} className="h-8 px-2 rounded-lg border border-amber-300 text-xs bg-white max-w-[220px]">
                                      <option value="">{s.name ? `“${s.name}” — pick user…` : "Pick user…"}</option>
                                      {userOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                                    </select>
                                  )
                                ) : <span className="text-gray-300 text-xs">↳</span>}
                              </td>
                              <td className="px-3 py-1.5 text-gray-700">{task}</td>
                              <td className="px-3 py-1.5">{ti === 0 ? <StatusCell s={s} /> : null}</td>
                            </tr>
                          );
                        }));
                      })()}
                    </tbody>
                  </table>
                </div>
              )}

              {summary.errors > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Resolve every highlighted row (pick the correct user) before creating. Import is all-or-nothing — no task is created while any row has an error.
                </div>
              )}
              {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

              <div className="flex items-center justify-end gap-2">
                <button onClick={createTasks} disabled={!canCreate} className="inline-flex items-center gap-1.5 px-4 h-10 rounded-lg text-sm font-semibold bg-[#164FA3] text-white hover:bg-[#123f85] disabled:opacity-40">
                  {creating ? <><Loader2 size={15} className="animate-spin" /> Creating {summary.ready} tasks…</> : <>Create {summary.ready} Task{summary.ready === 1 ? "" : "s"}</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
