"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Users, ChevronLeft, ChevronRight } from "lucide-react";

// Workers List for ONE generated link. The list is filtered SERVER-SIDE by
// worker_id + person_type=worker (see /api/registration/people): only the people
// who registered as workers through this karyakarta's link appear — never
// another link's. Admin-gated by the same registration access guard as the rest
// of the module. The count here and the "New workers" column in the Generate
// Links table both come from these same reg_people rows, so they always match.
const BRAND = "#0B3A82";

function Thumb({ src, name }) {
  const [ok, setOk] = useState(true);
  if (src && ok) return <img src={src} alt={name || ""} loading="lazy" className="w-10 h-10 rounded-full object-cover border border-gray-200 bg-white" onError={() => setOk(false)} />;
  return <div className="w-10 h-10 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-[#164FA3] font-bold text-sm">{String(name || "?").trim().charAt(0).toUpperCase() || "?"}</div>;
}
const fmtDate = (v) => (v ? new Date(String(v).replace(" ", "T")).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function LinkWorkersPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const workerId = params?.id;
  const passedName = search.get("name") || "";

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr("");
    const p = new URLSearchParams({ worker_id: String(workerId), person_type: "worker", page: String(page), pageSize: "50", sort: "newest" });
    fetch(`/api/registration/people?${p.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => { if (!alive) return; setRows(d.people || []); setTotal(d.total || 0); setPages(d.pages || 1); })
      .catch(async (r) => {
        if (!alive) return;
        if (r?.status === 403) setErr("You do not have access to this list.");
        else setErr("Could not load the workers list. Please try again.");
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [workerId, page]);

  const workerName = passedName || rows[0]?.worker_name || "this link";

  return (
    <div className="max-w-[1200px] mx-auto">
      <button onClick={() => router.push("/dashboard/admin/voter-registration")} className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-4">
        <ArrowLeft size={15} /> Back to Voter &amp; Worker Registration
      </button>

      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}><Users size={22} /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Workers List</h1>
          <p className="text-sm text-gray-500">Registered through: <span className="font-semibold text-gray-800">{workerName}</span></p>
        </div>
        <div className="ml-auto text-right">
          <div className="text-2xl font-bold" style={{ color: BRAND }}>{total}</div>
          <div className="text-xs text-gray-500">Total Workers</div>
        </div>
      </div>

      {err ? (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{err}</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500">
                  {["#", "Photo", "Name", "Mobile", "Address", "Constituency", "Ward", "Area / Booth", "Registered"].map((h) => (
                    <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-14 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-14 text-center text-gray-400"><Users size={28} className="mx-auto mb-2 opacity-40" />No workers have registered through this link yet.</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-500">{(page - 1) * 50 + i + 1}</td>
                    <td className="px-3 py-2.5"><Thumb src={r.photo_url} name={r.name} /></td>
                    <td className="px-3 py-2.5 font-medium text-gray-900">{r.name}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.mobile || "—"}</td>
                    <td className="px-3 py-2.5 text-gray-600 max-w-[220px] truncate">{r.address || "—"}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.assembly_name || "—"}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.effective_ward || r.ward_number || "—"}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.area_booth || "—"}</td>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtDate(r.registered_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
              <span>Page {page} of {pages} · {total} total</span>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="p-1.5 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronLeft size={16} /></button>
                <button disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} className="p-1.5 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronRight size={16} /></button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
