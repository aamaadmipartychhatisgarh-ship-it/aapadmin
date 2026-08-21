"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import SupervisorGuard from "@/components/SupervisorGuard";
import { canAccessMedia } from "@/lib/permissions";
import { ArrowLeft, Newspaper, Search, X, Loader2, Pencil, Trash2 } from "lucide-react";
import { PressNoteModal } from "@/app/dashboard/media/page";

export default function Page({ params }) {
  const { id } = use(params);
  return <SupervisorGuard allow={canAccessMedia}><Body newspaperId={id} /></SupervisorGuard>;
}

const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
function fmtNewsDate(v) {
  if (!v) return "—";
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function NewspaperPhoto({ url, title, onPreview }) {
  const box = "w-16 h-20 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0";
  if (url && IMAGE_RE.test(String(url).split("?")[0])) {
    return (
      <button type="button" onClick={() => onPreview?.(url)} className={`${box} hover:ring-2 hover:ring-[#164FA3]/40`} title="View full newspaper cutting">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={title || "Newspaper cutting"} loading="lazy" decoding="async" className="w-full h-full object-contain" />
      </button>
    );
  }
  if (url) return <a href={url} target="_blank" rel="noreferrer" className={`${box} text-[#164FA3] hover:ring-2 hover:ring-[#164FA3]/40`} title="Open uploaded file"><Newspaper size={26} /></a>;
  return <div className={`${box} text-gray-300`} title="No newspaper image"><Newspaper size={26} /></div>;
}

function Body({ newspaperId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lokOptions, setLokOptions] = useState([]);
  const [fDate, setFDate] = useState("");
  const [fLok, setFLok] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/media/newspapers/${newspaperId}/published-list`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "Failed to load the published list.");
      setData(d);
    } catch (e) { setError(e.message); setData(null); } finally { setLoading(false); }
  }, [newspaperId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true;
    fetch("/api/locations?type=lok_sabha").then((r) => (r.ok ? r.json() : { locations: [] })).then((d) => { if (alive) setLokOptions(d.locations || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  async function del(rec) {
    if (!confirm(`Delete this published record?\n\n${rec.title}`)) return;
    try {
      const r = await fetch(`/api/media/press-notes/${rec.id}`, { method: "DELETE" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || "Delete failed"); }
      load();
    } catch (e) { alert(e.message); }
  }

  const np = data?.newspaper;
  const hasFilters = fDate || fLok || fTitle.trim();
  const q = fTitle.trim().toLowerCase();
  const rows = (data?.records || []).filter((n) => {
    if (fDate && (n.coverage_date?.slice(0, 10) !== fDate)) return false;
    if (fLok) {
      if (fLok === "__all__") { if (!n.lok_sabha_all) return false; }
      else if (String(n.lok_sabha_id || "") !== String(fLok)) return false;
    }
    if (q && !String(n.title || "").toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <Link href="/dashboard/media" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#164FA3]"><ArrowLeft size={15} /> Back to Newspapers</Link>

      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center"><Newspaper size={22} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Published List{np ? ` · ${np.name}` : ""}</h1>
          <p className="text-sm text-gray-500">{np ? <>{np.lok_sabha_all ? "All Lok Sabha" : (np.lok_sabha_name || "—")} · {np.total_published} published record{np.total_published === 1 ? "" : "s"}</> : "Newspaper coverage records."}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700 text-sm">{error} <button onClick={load} className="ml-2 font-semibold underline">Retry</button></div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Date</label>
                <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Lok Sabha</label>
                <select value={fLok} onChange={(e) => setFLok(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3] min-w-[160px]">
                  <option value="">All Lok Sabha</option>
                  <option value="__all__">All (constituency-wide papers)</option>
                  {lokOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Search by Title</label>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="Type part of a title…" className="w-full border border-gray-200 rounded-lg pl-9 pr-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
                </div>
              </div>
              {hasFilters && <button onClick={() => { setFDate(""); setFLok(""); setFTitle(""); }} className="text-sm text-gray-500 hover:text-red-600 inline-flex items-center gap-1 py-1.5"><X size={14} /> Clear</button>}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {rows.length === 0 ? (
              <div className="p-8 text-gray-400 text-sm text-center">{hasFilters ? "No published records match the selected filters." : "No published records for this newspaper yet."}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Date</th>
                      <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Lok Sabha</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Title</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Brief</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Photo</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((n) => (
                      <tr key={n.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtNewsDate(n.coverage_date)}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{n.lok_sabha_all ? "All" : (n.lok_sabha_name || "—")}</td>
                        <td className="px-4 py-3 font-medium text-gray-900 max-w-[260px] whitespace-normal break-words">{n.title}</td>
                        <td className="px-4 py-3 text-gray-600 max-w-[320px] whitespace-normal break-words">{n.summary || "—"}</td>
                        <td className="px-4 py-3"><NewspaperPhoto url={n.file_url} title={n.title} onPreview={setPreview} /></td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button onClick={() => setEditing(n)} title="Edit" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg"><Pencil size={13} /></button>
                          <button onClick={() => del(n)} title="Delete" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {preview && (
        <div className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Newspaper cutting" className="max-w-[92vw] max-h-[92vh] rounded-lg object-contain" />
          <button onClick={() => setPreview(null)} className="absolute top-4 right-4 text-white/80 hover:text-white"><X size={28} /></button>
        </div>
      )}

      {editing && np && (
        <PressNoteModal
          editing={editing}
          newspapers={[{ id: np.id, name: np.name }]}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
