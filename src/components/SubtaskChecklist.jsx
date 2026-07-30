"use client";

import { useState } from "react";
import { Check } from "lucide-react";

// Reusable checklist for a master task. Renders each sub-task with a large,
// touch-friendly checkbox that saves instantly (PATCH) — no popup, no reload —
// with optimistic UI and a live progress bar. `onProgress(done,total,status)`
// lets the parent update its own summary/status without a refetch.
export default function SubtaskChecklist({ subtasks: initial = [], onProgress, compact = false }) {
  const [subs, setSubs] = useState(initial);
  const [busy, setBusy] = useState({});

  const total = subs.length;
  const done = subs.filter((s) => s.is_completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  async function toggle(sub) {
    const next = !sub.is_completed;
    // Optimistic update.
    const optimistic = subs.map((s) => (s.id === sub.id ? { ...s, is_completed: next } : s));
    setSubs(optimistic);
    setBusy((b) => ({ ...b, [sub.id]: true }));
    const nDone = optimistic.filter((s) => s.is_completed).length;
    onProgress?.(nDone, total, nDone === total && total > 0 ? "completed" : nDone > 0 ? "in_progress" : "pending");
    try {
      const r = await fetch(`/api/tasks/subtasks/${sub.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: next }),
      });
      if (!r.ok) throw new Error();
    } catch {
      // Revert on failure.
      const reverted = subs.map((s) => (s.id === sub.id ? { ...s, is_completed: sub.is_completed } : s));
      setSubs(reverted);
      const rDone = reverted.filter((s) => s.is_completed).length;
      onProgress?.(rDone, total, rDone === total && total > 0 ? "completed" : rDone > 0 ? "in_progress" : "pending");
    } finally {
      setBusy((b) => ({ ...b, [sub.id]: false }));
    }
  }

  if (total === 0) return null;

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      {/* Progress */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-semibold text-gray-600 shrink-0">{done}/{total}</span>
      </div>
      {/* Checklist */}
      <ul className="space-y-0.5">
        {subs.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => toggle(s)}
              disabled={busy[s.id]}
              className="w-full flex items-center gap-3 py-2 px-1 rounded-lg hover:bg-gray-50 text-left disabled:opacity-60"
            >
              <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                s.is_completed ? "bg-emerald-500 border-emerald-500 text-white" : "border-gray-300 bg-white"
              }`}>
                {s.is_completed && <Check size={14} strokeWidth={3} />}
              </span>
              <span className={`text-sm ${s.is_completed ? "text-gray-400 line-through" : "text-gray-800"}`}>{s.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
