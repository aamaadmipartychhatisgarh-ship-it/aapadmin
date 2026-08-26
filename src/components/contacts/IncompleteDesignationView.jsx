"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Users as UsersIcon } from "lucide-react";
import Avatar from "@/components/Avatar";

// CONTACTS → INCOMPLETE DESIGNATION — a simple, database-driven filtered view of
// the existing contacts. ONE main field dropdown ("Incomplete Data By") + a
// Blank/Fill status + a side Designation filter (from the Designation Master).
// Result = matching MEMBERS shown as PHOTO + NAME only. No text search, no other
// contact fields. All filtering happens server-side (fast on large tables).
const PAGE_SIZE = 60;

// The five selectable fields. Values are the API's field keys; "assembly" is the
// Vidhan Sabha. Labels only — the actual data comes from the DB per selection.
const FIELDS = [
  { v: "zone", l: "Zone" },
  { v: "lok_sabha", l: "Lok Sabha" },
  { v: "district", l: "District" },
  { v: "assembly", l: "Vidhan Sabha" },
  { v: "state", l: "State" },
];

const inp = "h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 outline-none focus:border-[#164FA3] focus:ring-1 focus:ring-[#164FA3]";

export default function IncompleteDesignationView() {
  const [field, setField] = useState("zone");
  const [status, setStatus] = useState("blank"); // blank | fill
  const [designationId, setDesignationId] = useState("");

  const [designations, setDesignations] = useState([]);
  const [members, setMembers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Designation options — live from the existing Designation Master (§6/§10).
  useEffect(() => {
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ field, status, page: String(page), page_size: String(PAGE_SIZE) });
    if (designationId) p.set("designation_id", designationId);
    fetch(`/api/contacts/incomplete?${p}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load."))))
      .then((d) => { setMembers(d.members || []); setTotal(d.total || 0); setError(""); })
      .catch((e) => setError(e.message || "Failed to load."))
      .finally(() => setLoading(false));
  }, [field, status, designationId, page]);

  useEffect(() => { load(); }, [load]);
  // Reset to the first page whenever a filter changes.
  useEffect(() => { setPage(1); }, [field, status, designationId]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fieldLabel = FIELDS.find((f) => f.v === field)?.l || field;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center"><AlertTriangle size={18} /></div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Incomplete Designation</h2>
          <p className="text-sm text-gray-500">Contacts whose selected hierarchy field is blank or filled — live from the database.</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* SIDE — Designation filter (§6/§12) */}
        <aside className="lg:w-64 shrink-0">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Designation</label>
            <select className={`${inp} w-full`} value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
              <option value="">All designations</option>
              {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-2">From the existing Designation Master. Narrows the members below to that designation.</p>
          </div>
        </aside>

        {/* MAIN — the one field dropdown + Blank/Fill, then the member list */}
        <div className="flex-1 min-w-0 space-y-5">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Incomplete Data By</label>
              <select className={inp} value={field} onChange={(e) => setField(e.target.value)}>
                {FIELDS.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Status</label>
              <select className={inp} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="blank">Blank ({fieldLabel} missing)</option>
                <option value="fill">Fill ({fieldLabel} filled)</option>
              </select>
            </div>
            <div className="ml-auto text-sm text-gray-500 self-center">
              {loading ? <span className="inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Loading…</span>
                : <span className="inline-flex items-center gap-1.5"><UsersIcon size={14} /> <strong className="text-gray-900">{total.toLocaleString()}</strong> member{total === 1 ? "" : "s"}</span>}
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2.5 text-sm">{error}</div>}

          {/* Member list — PHOTO + NAME only (§7/§8). */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 min-h-[200px]">
            {loading && members.length === 0 ? (
              <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
            ) : members.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-gray-400 text-center px-4">No members found for the selected filters.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 border border-gray-100 rounded-xl p-2.5 min-w-0">
                    <Avatar name={m.person_name} src={m.photo_url} size={44} className="bg-[#164FA3]/10 border border-gray-200 shrink-0" textClassName="text-[#164FA3]" />
                    <span className="font-semibold text-gray-900 truncate">{m.person_name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 text-sm">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Prev</button>
              <span className="text-gray-500">Page <strong className="text-gray-900">{page}</strong> of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
