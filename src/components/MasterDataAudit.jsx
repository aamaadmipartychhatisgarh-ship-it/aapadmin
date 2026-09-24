"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, Filter, X, ShieldCheck, ChevronLeft, ChevronRight } from "lucide-react";

const BRAND = "#164FA3";
const selCls = "h-9 rounded-lg border border-gray-200 text-sm px-2 text-gray-700 bg-white";

function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
}
function actionChip(a) {
  const s = String(a || "").toLowerCase();
  if (s.includes("creat")) return "bg-green-50 text-green-700 border-green-200";
  if (s.includes("delet")) return "bg-red-50 text-red-700 border-red-200";
  if (s.includes("deactiv") || s.includes("disable")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (s.includes("activ") || s.includes("enable")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s.includes("reorder")) return "bg-indigo-50 text-indigo-700 border-indigo-200";
  return "bg-blue-50 text-blue-700 border-blue-200"; // updated / other
}
// Render a stored value (string, or an object of changed fields) compactly.
function ValueCell({ value }) {
  if (value == null || value === "") return <span className="text-gray-300">—</span>;
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== "");
    if (!entries.length) return <span className="text-gray-300">—</span>;
    return (
      <div className="space-y-0.5">
        {entries.map(([k, v]) => (
          <div key={k} className="text-[11px]"><span className="text-gray-400">{k}: </span><span className="text-gray-700">{String(typeof v === "object" ? JSON.stringify(v) : v)}</span></div>
        ))}
      </div>
    );
  }
  return <span className="text-gray-700 text-xs whitespace-pre-wrap break-words">{String(value)}</span>;
}

// Administration → Master Data → Audit. READ-ONLY trail of every master-data
// create / edit / delete / activate / deactivate / reorder, from the shared
// audit_logs. No edit/delete of audit history from the UI.
export default function MasterDataAudit() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fAction, setFAction] = useState("");
  const [fMaster, setFMaster] = useState("");
  const [fUser, setFUser] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 350); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), limit: "30" });
      if (debounced.trim()) p.set("search", debounced.trim());
      if (fAction) p.set("action", fAction);
      if (fMaster) p.set("master", fMaster);
      if (fUser) p.set("user", fUser);
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
      const r = await fetch(`/api/admin/master-audit?${p}`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }, [page, debounced, fAction, fMaster, fUser, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const anyFilter = search || fAction || fMaster || fUser || dateFrom || dateTo;
  const clear = () => { setSearch(""); setFAction(""); setFMaster(""); setFUser(""); setDateFrom(""); setDateTo(""); setPage(1); };
  const logs = data?.logs || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}><ShieldCheck size={20} /></div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Master Data — Audit</h2>
          <p className="text-sm text-gray-500">A read-only record of every master-data change. Audit history cannot be edited or deleted.</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3 text-gray-600"><Filter size={15} /><span className="text-sm font-semibold">Filters</span></div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="relative col-span-2 md:col-span-1 lg:col-span-2">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search record, user…" className="w-full pl-8 pr-2 h-9 rounded-lg border border-gray-200 text-sm" />
          </div>
          <select value={fMaster} onChange={(e) => { setFMaster(e.target.value); setPage(1); }} className={selCls}>
            <option value="">All masters</option>
            {(data?.masters || []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <select value={fAction} onChange={(e) => { setFAction(e.target.value); setPage(1); }} className={selCls}>
            <option value="">All actions</option>
            {(data?.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={fUser} onChange={(e) => { setFUser(e.target.value); setPage(1); }} className={selCls}>
            <option value="">All users</option>
            {(data?.users || []).filter((u) => u.name).map((u) => <option key={u.id ?? u.name} value={u.id ?? u.name}>{u.name}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className={`${selCls} flex-1`} title="From date" />
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className={`${selCls} flex-1`} title="To date" />
          </div>
        </div>
        {anyFilter && <button onClick={clear} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"><X size={13} /> Clear filters</button>}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-3 py-3 font-semibold">Date &amp; Time</th>
                <th className="px-3 py-3 font-semibold">User</th>
                <th className="px-3 py-3 font-semibold">Master</th>
                <th className="px-3 py-3 font-semibold">Action</th>
                <th className="px-3 py-3 font-semibold">Record</th>
                <th className="px-3 py-3 font-semibold">Previous Value</th>
                <th className="px-3 py-3 font-semibold">New Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-gray-400">No master-data changes recorded for these filters.</td></tr>
              ) : logs.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 align-top">
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 text-xs">{fmtDateTime(r.created_at)}</td>
                  <td className="px-3 py-2.5">
                    <div className="text-gray-900 font-medium text-sm">{r.actor_name || "—"}</div>
                    {r.actor_user_id != null && <div className="text-[11px] text-gray-400 font-mono">ID {r.actor_user_id}</div>}
                    {r.ip && <div className="text-[11px] text-gray-400">{r.ip}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">{r.master || "—"}</td>
                  <td className="px-3 py-2.5"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border capitalize ${actionChip(r.action)}`}>{r.action}</span></td>
                  <td className="px-3 py-2.5">
                    <div className="text-gray-900 text-sm">{r.record_name || "—"}</div>
                    {r.record_id != null && <div className="text-[11px] text-gray-400 font-mono">#{r.record_id}</div>}
                  </td>
                  <td className="px-3 py-2.5 max-w-[220px]"><ValueCell value={r.previous_value} /></td>
                  <td className="px-3 py-2.5 max-w-[220px]"><ValueCell value={r.new_value} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && (data?.total || 0) > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
            <span>Page {data.page} of {data.pages} · {Number(data.total).toLocaleString("en-IN")} entries</span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="p-1.5 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronLeft size={16} /></button>
              <button disabled={page >= (data.pages || 1)} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
