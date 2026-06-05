"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isAdmin, isOversight } from "@/lib/permissions";
import { Users, Plus, Search, Upload, Loader2, CheckCircle2, ChevronLeft, ChevronRight, Activity } from "lucide-react";

export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isOversight(session)) router.push("/dashboard");
  }, [status, session, router]);
  if (status !== "authenticated" || !isOversight(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body session={session} />;
}

function Body({ session }) {
  const canEdit = isAdmin(session);
  const [data, setData] = useState({ workers: [], total: 0, page: 1, pages: 1 });
  const [districts, setDistricts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
  }, []);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, districtId, statusFilter, page]);

  async function load() {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), limit: "20" });
    if (search) p.set("search", search);
    if (districtId) p.set("district_id", districtId);
    if (statusFilter) p.set("status", statusFilter);
    const r = await fetch(`/api/workers?${p}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }

  async function uploadCsv(file) {
    setMessage("");
    const text = await file.text();
    const r = await fetch("/api/workers/upload-csv", { method: "POST", headers: { "Content-Type": "text/csv" }, body: text });
    const d = await r.json();
    if (r.ok) { setMessage(`Imported ${d.inserted} workers.`); load(); }
    else setMessage(d.message || "Upload failed");
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Workers</h1>
          <p className="text-gray-500 mt-2 font-medium">{data.total} members across the organization.</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium shadow-sm">
              <Upload size={16} /> Import CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])} />
            <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-md">
              <Plus size={16} /> Add Worker
            </button>
          </div>
        )}
      </div>

      {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center gap-2"><CheckCircle2 size={16} />{message}</div>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name or mobile" className="flex-1 min-w-[180px] outline-none text-sm py-2" />
        <select value={districtId} onChange={(e) => { setDistrictId(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-sm">
          <option value="">All districts</option>
          {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-sm">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : data.workers.length === 0 ? (
          <div className="p-12 text-center text-gray-400"><Users size={36} className="mx-auto text-gray-300 mb-3" />No workers match.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Mobile</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Position</th>
                <th className="px-4 py-3 font-semibold text-gray-600">District</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Assembly</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Activity</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.workers.map((w) => (
                <tr key={w.id} className="border-t border-gray-100 hover:bg-blue-50/30 cursor-pointer" onClick={() => location.href = `/dashboard/admin/workers/${w.id}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{w.name}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{w.mobile || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{w.position || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{w.district_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{w.assembly_name || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#164FA3]" style={{ width: `${w.activity_score}%` }} />
                      </div>
                      <span className="text-xs font-bold text-gray-700 w-7">{w.activity_score}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${w.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                      {w.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && data.pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm bg-gray-50">
            <span className="text-gray-500">Page {data.page} of {data.pages}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40"><ChevronLeft size={16} /></button>
              <button disabled={page >= data.pages} onClick={() => setPage(page + 1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>

      {showAdd && <AddWorkerModal districts={districts} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddWorkerModal({ districts, onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", mobile: "", position: "", skills: "", district_id: "", assembly_id: "", status: "active", activity_score: 50 });
  const [assemblies, setAssemblies] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (form.district_id) {
      fetch(`/api/locations?parent_id=${form.district_id}`).then((r) => r.json()).then((d) => setAssemblies(d.locations || []));
    } else setAssemblies([]);
  }, [form.district_id]);

  async function save() {
    setSaving(true); setError("");
    const r = await fetch("/api/workers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await r.json();
    if (r.ok) onSaved(); else { setError(d.message || "Failed"); setSaving(false); }
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-auto">
        <h2 className="text-xl font-bold text-gray-900">Add Worker</h2>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <input className={inp} placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inp} placeholder="Mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          <input className={inp} placeholder="Position" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
          <input className={inp} placeholder="Skills (comma-sep)" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} />
          <select className={inp} value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value, assembly_id: "" })}>
            <option value="">District</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className={inp} value={form.assembly_id} onChange={(e) => setForm({ ...form, assembly_id: e.target.value })} disabled={!form.district_id}>
            <option value="">Assembly</option>
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <div>
            <label className="text-xs text-gray-500">Activity score: {form.activity_score}</label>
            <input type="range" min="0" max="100" value={form.activity_score} onChange={(e) => setForm({ ...form, activity_score: Number(e.target.value) })} className="w-full" />
          </div>
        </div>
        <p className="text-xs text-gray-400">QR / Aadhaar scan import — coming soon (architecture placeholder).</p>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving || !form.name} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
