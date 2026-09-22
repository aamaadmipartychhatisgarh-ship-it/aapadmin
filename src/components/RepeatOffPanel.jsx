"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Loader2, RefreshCcw, Phone, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import Avatar from "@/components/Avatar";

// Reusable "10+ Times Off" list — the ONE place the repeat-off search + table +
// pager is built, so the standalone Repeat-Off page and the Contacts → Wrong
// Number tabs render identically from the SAME backend source
// (/api/contacts/repeat-off), with no duplicated logic.
//
// `type` is "switched" | "incoming" — the established business rule (10+ of that
// call outcome) lives entirely in the API; this panel only displays whatever the
// database counted, and the count shown is unique qualifying CONTACTS (the API
// GROUPs by contact), never a row-per-call.
export default function RepeatOffPanel({ type }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ type, page: String(page), page_size: "50" });
      if (search) p.set("search", search);
      const r = await fetch(`/api/contacts/repeat-off?${p}`, { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        setRows(d.contacts || []);
        setTotal(d.total || 0);
        setTotalPages(d.totalPages || 1);
      }
    } finally { setLoading(false); }
  }, [type, page, search]);

  // Explicitly restore a contact to Main Contacts (per this list's type). Confirms
  // first; the backend stamps the restore time (history preserved) and the contact
  // leaves this list and becomes active/assignable again.
  const restore = useCallback(async (c) => {
    if (!window.confirm(`Restore ${c.person_name || "this contact"} to Main Contacts? Its call history stays intact and it becomes assignable again.`)) return;
    setRestoringId(c.id);
    try {
      const r = await fetch(`/api/contacts/repeat-off/${c.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (r.ok) load();
      else {
        const d = await r.json().catch(() => ({}));
        alert(d.message || "Could not restore this contact.");
      }
    } finally { setRestoringId(null); }
  }, [type, load]);

  // Reset to page 1 whenever the type (tab) or search changes, so switching tabs
  // never lands on an out-of-range page from the previous list.
  useEffect(() => { setPage(1); }, [type, search]);
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / phone…"
                 className="w-full pl-9 h-10 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
        </div>
        <button onClick={() => setSearch("")} className="h-10 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2">
          <RefreshCcw size={14} /> Reset
        </button>
        <span className="ml-auto text-sm text-gray-500"><strong className="text-gray-900">{Number(total).toLocaleString("en-IN")}</strong> contact{total === 1 ? "" : "s"}</span>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Phone</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Designation</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Location</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Caller</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">{type === "incoming" ? "Incoming Off" : "Switched Off"} count</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" className="py-12 text-center text-gray-400"><Loader2 className="inline animate-spin text-[#164FA3]" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan="7" className="py-12 text-center text-gray-400">No contacts have crossed the 10+ threshold for this status.</td></tr>
              ) : rows.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <Avatar name={c.person_name} src={c.photo_url} size={26} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-[10px]" />
                      <span className="font-medium text-gray-900">{c.person_name}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap"><Phone size={11} className="inline mr-1 text-gray-400" />{c.phone_number}</td>
                  <td className="px-4 py-3 text-gray-700">{c.designation_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{[c.district_name, c.assembly_name].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.assigned_to_username || "—"}</td>
                  <td className="px-4 py-3 text-right"><span className="inline-flex items-center px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 font-bold">{c.off_count}</span></td>
                  <td className="px-4 py-3">
                    <button onClick={() => restore(c)} disabled={restoringId === c.id} title="Restore to Main Contacts"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#164FA3] hover:bg-blue-50 px-2.5 py-1.5 rounded-lg disabled:opacity-50">
                      {restoringId === c.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm bg-gray-50">
            <span className="text-gray-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="h-8 px-3 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-white inline-flex items-center gap-1"><ChevronLeft size={14} /> Prev</button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="h-8 px-3 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-white inline-flex items-center gap-1">Next <ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
