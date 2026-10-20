"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";

const STATUS = {
  open: "bg-red-100 text-red-700", in_progress: "bg-blue-100 text-blue-700",
  resolved: "bg-emerald-100 text-emerald-700", closed: "bg-gray-100 text-gray-500",
};
const fmt = (v) => (v ? new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null);

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm text-gray-900 break-words">{children || <span className="text-gray-300">—</span>}</div>
    </div>
  );
}
function Block({ label, text }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900 whitespace-pre-wrap break-words max-h-[40vh] overflow-y-auto">
        {text || <span className="text-gray-300">—</span>}
      </div>
    </div>
  );
}

// Full details of ONE complaint, fetched by its unique id (so two complaints with
// the same complainant name never get mixed up). Text is shown in full — multiline
// and special characters preserved, long words wrapped — never truncated.
export default function ComplaintDetailModal({ id, onClose }) {
  const [state, setState] = useState({ loading: true, error: "", c: null });

  useEffect(() => {
    let alive = true;
    fetch(`/api/complaints/${id}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) setState({ loading: false, error: d.message || "Could not load this complaint.", c: null });
        else setState({ loading: false, error: "", c: d.complaint });
      })
      .catch(() => { if (alive) setState({ loading: false, error: "Could not load this complaint.", c: null }); });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const c = state.c;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Complaint details">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-gray-900 break-words">{c ? c.citizen_name : "Complaint"}</h2>
            {c && <div className="text-xs text-gray-400 font-mono mt-0.5">Complaint #{c.id}</div>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0" aria-label="Close"><X size={20} /></button>
        </div>

        {state.loading && <div className="py-10 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>}
        {state.error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{state.error}</div>}

        {c && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${STATUS[c.status] || "bg-gray-100 text-gray-600"}`}>{String(c.status || "").replace("_", " ")}</span>
              {c.overdue && <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-red-600 text-white">Overdue</span>}
            </div>

            <Block label="Description" text={c.description} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Complainant">{c.citizen_name}</Field>
              <Field label="Phone">{c.citizen_phone}</Field>
              <Field label="Designation">{c.designation_name}</Field>
              <Field label="Category / Type">{c.type ? String(c.type).replace(/^./, (m) => m.toUpperCase()) : ""}</Field>
              <Field label="Assembly">{c.assembly_name}</Field>
              <Field label="District">{c.district_name}</Field>
              <Field label="Department / Assigned team">{c.team_name}</Field>
              <Field label="Logged on">{fmt(c.created_at)}</Field>
              <Field label="Resolved on">{fmt(c.resolved_at)}</Field>
            </div>

            <Block label="Resolution notes / Remarks" text={c.resolution_notes} />
          </>
        )}

        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Close</button>
        </div>
      </div>
    </div>
  );
}
