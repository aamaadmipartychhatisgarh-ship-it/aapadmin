"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { isOversight } from "@/lib/permissions";
import { MessageSquare, Plus, Loader2, X, Droplet, Construction, Zap, Package, HelpCircle, Search } from "lucide-react";

const TYPE_META = {
  water: { label: "Water", icon: Droplet, color: "text-sky-600 bg-sky-50" },
  roads: { label: "Roads", icon: Construction, color: "text-amber-600 bg-amber-50" },
  electricity: { label: "Electricity", icon: Zap, color: "text-yellow-600 bg-yellow-50" },
  ration: { label: "Ration", icon: Package, color: "text-emerald-600 bg-emerald-50" },
  other: { label: "Other", icon: HelpCircle, color: "text-gray-600 bg-gray-100" },
};
const STATUS = {
  open: "bg-red-100 text-red-700", in_progress: "bg-blue-100 text-blue-700",
  resolved: "bg-emerald-100 text-emerald-700", closed: "bg-gray-100 text-gray-500",
};
const STATUS_OPTS = ["open", "in_progress", "resolved", "closed"];

// Caller-facing complaints page: log a complaint heard during a call and
// track its status. Resolution is handled by admins on the admin page.
export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    // Oversight roles have their own complaints page under /dashboard/admin.
    else if (status === "authenticated" && isOversight(session)) router.push("/dashboard/admin/complaints");
  }, [status, session, router]);
  if (status !== "authenticated" || isOversight(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body />;
}

function Body() {
  const [data, setData] = useState({ complaints: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [districts, setDistricts] = useState([]);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
  }, []);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search, typeFilter, districtId]);
  async function load() {
    setLoading(true);
    const p = new URLSearchParams();
    if (filter) p.set("status", filter);
    if (search) p.set("search", search);
    if (typeFilter) p.set("type", typeFilter);
    if (districtId) p.set("district_id", districtId);
    const r = await fetch(`/api/complaints?${p}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }
  const c = data.counts || {};

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Complaints</h1>
          <p className="text-gray-500 mt-2 font-medium">Log citizen civic issues you hear on calls.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-md">
          <Plus size={16} /> Log Complaint
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SumCard label="Total" value={c.total || 0} accent />
        <SumCard label="Open" value={c.open || 0} danger={Number(c.open) > 0} />
        <SumCard label="In Progress" value={c.in_progress || 0} />
        <SumCard label="Resolved" value={c.resolved || 0} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search citizen name or phone" className="flex-1 min-w-[180px] outline-none text-sm py-2" />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All types</option>
          {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All districts</option>
          {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["", ...STATUS_OPTS].map((s) => (
          <button key={s || "all"} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase ${filter === s ? "bg-[#164FA3] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{s || "all"}</button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : data.complaints.length === 0 ? (
          <div className="p-12 text-center text-gray-400"><MessageSquare size={36} className="mx-auto text-gray-300 mb-3" />No complaints yet. Log the first one.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold text-gray-600">#</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Citizen</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Type</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">District</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Description</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.complaints.map((cm) => {
                  const tm = TYPE_META[cm.type] || TYPE_META.other;
                  const Icon = tm.icon;
                  return (
                    <tr key={cm.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                      <td className="px-4 py-3 text-gray-400 font-mono text-xs">#{cm.id}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{cm.citizen_name}</div>
                        <div className="text-xs text-gray-400">{cm.citizen_phone || ""}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ${tm.color}`}><Icon size={12} /> {tm.label}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{cm.district_name || "—"}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-xs"><div className="line-clamp-2">{cm.description || <span className="text-gray-300">—</span>}</div></td>
                      <td className="px-4 py-3"><span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${STATUS[cm.status]}`}>{cm.status.replace("_", " ")}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function SumCard({ label, value, accent, danger }) {
  return (
    <div className={`${accent ? "bg-[#164FA3] text-white" : danger ? "bg-red-50 border border-red-200" : "bg-white border border-gray-100"} rounded-xl p-4 shadow-sm`}>
      <div className={`text-2xl font-bold ${accent ? "" : danger ? "text-red-700" : "text-gray-900"}`}>{value}</div>
      <div className={`text-xs font-medium mt-1 ${accent ? "text-blue-200" : danger ? "text-red-500" : "text-gray-500"}`}>{label}</div>
    </div>
  );
}

function AddModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ citizen_name: "", citizen_phone: "", type: "water", description: "", district_id: "" });
  const [districts, setDistricts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || [])); }, []);
  async function save() {
    setSaving(true); setError("");
    const r = await fetch("/api/complaints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) onSaved();
    else {
      const d = await r.json().catch(() => ({}));
      setError(d.message || "Failed to log complaint");
      setSaving(false);
    }
  }
  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-gray-900">Log Complaint</h2><button onClick={onClose} className="text-gray-400"><X size={20} /></button></div>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
        <input className={inp} placeholder="Citizen name *" value={form.citizen_name} onChange={(e) => setForm({ ...form, citizen_name: e.target.value })} />
        <input className={inp} placeholder="Phone" value={form.citizen_phone} onChange={(e) => setForm({ ...form, citizen_phone: e.target.value })} />
        <select className={inp} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className={inp} value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value })}>
          <option value="">District</option>
          {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <textarea className={inp} rows={2} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving || !form.citizen_name} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : "Log"}</button>
        </div>
      </div>
    </div>
  );
}
