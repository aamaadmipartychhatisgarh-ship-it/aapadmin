"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { isAdmin } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";
import Avatar from "@/components/Avatar";
import { Loader2, Search, RefreshCw, Wrench, Image as ImageIcon, CheckCircle2, X, ChevronLeft, ChevronRight } from "lucide-react";

const BRAND = "#164FA3";

function StatCard({ label, value, tone }) {
  const cls = { green: "border-green-200 text-green-700", red: "border-red-200 text-red-700", amber: "border-amber-200 text-amber-700", brand: "bg-[#164FA3] text-white border-transparent" }[tone] || "border-gray-200 text-gray-900";
  const isBrand = tone === "brand";
  return (
    <div className={`rounded-xl p-4 shadow-sm border ${isBrand ? cls : `bg-white ${cls}`}`}>
      <div className={`text-2xl font-bold ${isBrand ? "text-white" : ""}`}>{value == null ? "—" : Number(value).toLocaleString("en-IN")}</div>
      <div className={`text-xs font-medium mt-1 ${isBrand ? "text-blue-100" : "text-gray-500"}`}>{label}</div>
    </div>
  );
}

function statusBadge(v) {
  if (v === 1) return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">Available</span>;
  if (v === 0) return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200">Photo Not Available</span>;
  return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border bg-gray-50 text-gray-500 border-gray-200">Not checked</span>;
}

export default function PhotoDataPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("contacts", isAdmin(session));

  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [toast, setToast] = useState(null);

  const flash = (type, text) => { setToast({ type, text }); setTimeout(() => setToast(null), 5000); };

  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 350); return () => clearTimeout(t); }, [search]);

  const loadSummary = useCallback(async () => {
    try { const r = await fetch("/api/admin/contacts/photo-data?summary=1", { cache: "no-store" }); if (r.ok) setSummary((await r.json()).summary); } catch {}
  }, []);
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), page_size: "30" });
      if (debounced.trim()) p.set("search", debounced.trim());
      if (fStatus) p.set("status", fStatus);
      const r = await fetch(`/api/admin/contacts/photo-data?${p}`, { cache: "no-store" });
      if (r.ok) { const d = await r.json(); setRows(d.rows || []); setTotal(d.total || 0); setPages(d.pages || 1); }
    } finally { setLoading(false); }
  }, [page, debounced, fStatus]);

  useEffect(() => { if (allowed) { loadSummary(); loadList(); } }, [allowed, loadSummary, loadList]);

  async function runRecovery() {
    if (recovering) return;
    setRecovering(true);
    flash("success", "Recovery running — reconnecting photos whose files still exist…");
    try {
      // Process in pages so large datasets complete without a single huge request.
      let offset = 0, totalRecovered = 0, totalValid = 0, guard = 0;
      for (;;) {
        const r = await fetch("/api/admin/contacts/photo-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offset, limit: 2000 }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { flash("error", d.message || "Recovery failed."); break; }
        totalRecovered += d.recovered || 0; totalValid += d.valid || 0;
        if (!d.more || guard++ > 50) { flash("success", `Recovery complete — ${totalValid.toLocaleString("en-IN")} valid photos, ${totalRecovered.toLocaleString("en-IN")} reconnected.`); break; }
        offset += 2000;
      }
      loadSummary(); loadList();
    } catch { flash("error", "Recovery failed."); }
    finally { setRecovering(false); }
  }

  if (status === "loading" || !ready) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin" style={{ color: BRAND }} /></div>;
  if (!allowed) { router.push("/dashboard"); return null; }

  const s = summary || {};
  const selCls = "h-10 rounded-lg border border-gray-200 text-sm px-2 text-gray-700 bg-white";

  return (
    <div className="max-w-[1200px] mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}><ImageIcon size={22} /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Photo Data</h1>
            <p className="text-sm text-gray-500">Audited contact photos — recover previously uploaded images wherever their files still exist.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { loadSummary(); loadList(); }} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw size={16} /> Refresh</button>
          <button onClick={runRecovery} disabled={recovering} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-white text-sm font-semibold disabled:opacity-60" style={{ background: BRAND }}>
            {recovering ? <Loader2 size={16} className="animate-spin" /> : <Wrench size={16} />} Recover Photos
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Contacts with a photo reference" value={s.with_reference} tone="brand" />
        <StatCard label="Photos available (recovered/valid)" value={s.available} tone="green" />
        <StatCard label="Photo not available" value={s.unavailable} tone="red" />
        <StatCard label="Not yet checked" value={s.unverified} tone="amber" />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or mobile…" className="w-full pl-9 pr-3 h-10 rounded-lg border border-gray-200 text-sm" />
        </div>
        <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }} className={selCls}>
          <option value="">All photo statuses</option>
          <option value="available">Available</option>
          <option value="unavailable">Not available</option>
          <option value="unverified">Not checked</option>
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-semibold">Photo</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Mobile Number</th>
                <th className="px-4 py-3 font-semibold">Photo Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-16 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-16 text-center text-gray-400">No contact photos for these filters.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    {r.photo_verified === 0
                      ? <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-300"><ImageIcon size={18} /></div>
                      : <Avatar name={r.name} src={r.photo_url} size={40} square className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-[11px]" />}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{r.name || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">{r.mobile || "—"}</td>
                  <td className="px-4 py-2.5">{statusBadge(r.photo_verified)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
            <span>Page {page} of {pages} · {total.toLocaleString("en-IN")} total</span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="p-1.5 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronLeft size={16} /></button>
              <button disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} className="p-1.5 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[140] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.type === "success" ? <CheckCircle2 size={16} /> : <X size={16} />} {toast.text}
        </div>
      )}
    </div>
  );
}
