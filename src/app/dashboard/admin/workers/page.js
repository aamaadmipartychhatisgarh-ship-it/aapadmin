"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isAdmin, isOversight } from "@/lib/permissions";
import { Users, Plus, Search, Upload, Loader2, CheckCircle2, ChevronLeft, ChevronRight, Activity, Pencil } from "lucide-react";

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
  const [designations, setDesignations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [zones, setZones] = useState([]);
  const [zoneId, setZoneId] = useState("");
  const [lokSabhas, setLokSabhas] = useState([]);
  const [lokSabhaId, setLokSabhaId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [assemblies, setAssemblies] = useState([]);
  const [assemblyId, setAssemblyId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);
  const excelRef = useRef(null);

  useEffect(() => {
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || []));
  }, []);

  // Lok Sabha options follow the selected zone (all when no zone picked).
  useEffect(() => {
    const url = zoneId ? `/api/locations?parent_id=${zoneId}` : "/api/locations?type=lok_sabha";
    fetch(url).then((r) => r.json()).then((d) => setLokSabhas(d.locations || []));
    setLokSabhaId("");
  }, [zoneId]);

  // Assembly filter is independent of district: imported workers can carry an
  // assembly without a matching district, so requiring a district first made
  // assembly-wise search miss them. Show all assemblies unless a district is
  // picked (then narrow the options to that district's assemblies).
  useEffect(() => {
    const url = districtId ? `/api/locations?parent_id=${districtId}` : "/api/locations?type=assembly";
    fetch(url).then((r) => r.json()).then((d) => setAssemblies(d.locations || []));
    setAssemblyId("");
  }, [districtId]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, zoneId, lokSabhaId, districtId, assemblyId, statusFilter, positionFilter, page]);

  async function load() {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), limit: "20" });
    if (search) p.set("search", search);
    if (zoneId) p.set("zone_id", zoneId);
    if (lokSabhaId) p.set("lok_sabha_id", lokSabhaId);
    if (districtId) p.set("district_id", districtId);
    if (assemblyId) p.set("assembly_id", assemblyId);
    if (statusFilter) p.set("status", statusFilter);
    if (positionFilter) p.set("position", positionFilter);
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

  // Import from an Excel (.xlsx/.xls/.csv) file — handles the MEMBER LIST format.
  async function importExcel(file) {
    setMessage("");
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/workers/import-excel", { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok) {
        let msg = `Members: ${d.workers_inserted} new, ${d.workers_updated} updated → Contacts: ${d.contacts_inserted} new, ${d.contacts_updated} updated.`;
        if (d.unmatched_assemblies?.length) msg += ` Unmatched assemblies: ${d.unmatched_assemblies.slice(0, 5).join(", ")}${d.unmatched_assemblies.length > 5 ? "…" : ""}.`;
        setMessage(msg);
        load();
      } else {
        setMessage(d.message || "Import failed");
      }
    } catch {
      setMessage("Import failed — file too large or network error.");
    } finally {
      setImporting(false);
      if (excelRef.current) excelRef.current.value = "";
    }
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
            <button onClick={() => excelRef.current?.click()} disabled={importing} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-sm">
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {importing ? "Importing…" : "Import Excel"}
            </button>
            <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => e.target.files?.[0] && importExcel(e.target.files[0])} />
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
        <select value={zoneId} onChange={(e) => { setZoneId(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-sm">
          <option value="">All zones</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <select value={lokSabhaId} onChange={(e) => { setLokSabhaId(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-sm">
          <option value="">All Lok Sabhas</option>
          {lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={districtId} onChange={(e) => { setDistrictId(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-sm">
          <option value="">All districts</option>
          {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={assemblyId} onChange={(e) => { setAssemblyId(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-sm">
          <option value="">All assemblies</option>
          {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={positionFilter} onChange={(e) => { setPositionFilter(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-sm">
          <option value="">All designations</option>
          {designations.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
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
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Mobile</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Designation</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Zone</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Lok Sabha</th>
                <th className="px-4 py-3 font-semibold text-gray-600">District</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Assembly</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Address</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Activity</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                {canEdit && <th className="px-4 py-3 font-semibold text-gray-600 text-right">Edit</th>}
              </tr>
            </thead>
            <tbody>
              {data.workers.map((w) => (
                <tr key={w.id} className="border-t border-gray-100 hover:bg-blue-50/30 cursor-pointer" onClick={() => location.href = `/dashboard/admin/workers/${w.id}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      {w.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={w.photo_url} alt="" className="w-8 h-8 rounded-full object-cover border border-gray-200 shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 text-[10px] font-bold shrink-0">
                          {(w.name || "?")[0].toUpperCase()}
                        </div>
                      )}
                      <span>{w.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{w.mobile || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{w.position || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{w.zone_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{w.lok_sabha_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{w.district_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{w.assembly_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs max-w-[200px] truncate" title={w.address || ""}>{w.address || "—"}</td>
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
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <button onClick={(e) => { e.stopPropagation(); setEditing(w); }} className="inline-flex items-center gap-1 text-xs text-[#164FA3] hover:bg-blue-50 px-2 py-1 rounded-lg font-medium">
                        <Pencil size={14} /> Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
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

      {showAdd && <AddWorkerModal districts={districts} designations={designations} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {editing && <EditWorkerModal worker={editing} districts={districts} designations={designations} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

// Shared Add/Edit worker form. Field labels: Sambhag (Zone), Block (ward),
// Polling Station (booth) — DB column names unchanged.
function WorkerModal({ title, initial, isEdit, districts, designations, onClose, onSave, saving, error }) {
  const [form, setForm] = useState(initial);
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [wards, setWards] = useState([]);
  const [booths, setBooths] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const photoRef = useRef(null);

  useEffect(() => {
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
  }, []);
  useEffect(() => {
    if (form.zone_id) fetch(`/api/locations?parent_id=${form.zone_id}`).then((r) => r.json()).then((d) => setLokSabhas(d.locations || []));
    else fetch("/api/locations?type=lok_sabha").then((r) => r.json()).then((d) => setLokSabhas(d.locations || []));
  }, [form.zone_id]);
  useEffect(() => {
    if (form.district_id) fetch(`/api/locations?parent_id=${form.district_id}`).then((r) => r.json()).then((d) => setAssemblies(d.locations || []));
    else setAssemblies([]);
  }, [form.district_id]);
  useEffect(() => {
    if (form.assembly_id) fetch(`/api/locations?parent_id=${form.assembly_id}`).then((r) => r.json()).then((d) => setWards(d.locations || []));
    else setWards([]);
  }, [form.assembly_id]);
  useEffect(() => {
    if (form.ward_id) fetch(`/api/locations?parent_id=${form.ward_id}`).then((r) => r.json()).then((d) => setBooths(d.locations || []));
    else setBooths([]);
  }, [form.ward_id]);

  async function uploadPhoto(file) {
    setUploadError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/uploads", { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok) setForm((f) => ({ ...f, photo_url: d.url }));
      else setUploadError(d.message || "Upload failed");
    } catch {
      setUploadError("Upload failed — network error.");
    } finally {
      setUploading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  // A worker can hold multiple designations — stored comma-separated in `position`.
  const selectedDesignations = (form.position || "").split(",").map((s) => s.trim()).filter(Boolean);
  const customDesignations = selectedDesignations.filter((n) => !designations.some((d) => d.name === n));
  function toggleDesignation(name) {
    const next = selectedDesignations.includes(name)
      ? selectedDesignations.filter((n) => n !== name)
      : [...selectedDesignations, name];
    setForm({ ...form, position: next.join(", ") });
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-auto">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
        {uploadError && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{uploadError}</div>}

        {/* Photo */}
        <div className="flex items-center gap-3">
          {form.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.photo_url} alt="Worker photo" className="w-14 h-14 rounded-full object-cover border border-gray-200" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400"><Users size={20} /></div>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => photoRef.current?.click()} disabled={uploading} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {uploading ? "Uploading…" : form.photo_url ? "Change photo" : "Upload photo"}
            </button>
            {form.photo_url && (
              <button type="button" onClick={() => setForm({ ...form, photo_url: "" })} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Remove</button>
            )}
            <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Fld label="Name *"><input className={inp} placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Fld>
          <Fld label="Mobile"><input className={inp} placeholder="Mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></Fld>
          <div className="col-span-2">
            <Fld label="Designations (select one or more)">
              <div className="flex flex-wrap gap-2">
                {/* Imported workers can carry designations that aren't in the master list — keep them removable. */}
                {customDesignations.map((n) => (
                  <button key={n} type="button" onClick={() => toggleDesignation(n)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-[#164FA3] text-white border-[#164FA3]">
                    ✓ {n}
                  </button>
                ))}
                {designations.map((d) => {
                  const on = selectedDesignations.includes(d.name);
                  return (
                    <button key={d.id} type="button" onClick={() => toggleDesignation(d.name)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${on ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200 hover:border-[#164FA3]"}`}>
                      {on ? "✓ " : ""}{d.name}
                    </button>
                  );
                })}
                {designations.length === 0 && customDesignations.length === 0 && (
                  <span className="text-xs text-gray-400">No designations yet — add them in Master Data.</span>
                )}
              </div>
            </Fld>
          </div>
          {!isEdit && <Fld label="Skills"><input className={inp} placeholder="Skills (comma-sep)" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} /></Fld>}
          <div className="col-span-2">
            <Fld label="Address"><input className={inp} placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Fld>
          </div>
          <Fld label="Sambhag (Zone)">
            <select className={inp} value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value, lok_sabha_id: "" })}>
              <option value="">Select Sambhag</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </Fld>
          <Fld label="Lok Sabha">
            <select className={inp} value={form.lok_sabha_id} onChange={(e) => setForm({ ...form, lok_sabha_id: e.target.value })}>
              <option value="">Select Lok Sabha</option>
              {lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Fld>
          <Fld label="District">
            <select className={inp} value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value, assembly_id: "", ward_id: "", booth_id: "" })}>
              <option value="">Select district</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Fld>
          <Fld label="Assembly">
            <select className={inp} value={form.assembly_id} onChange={(e) => setForm({ ...form, assembly_id: e.target.value, ward_id: "", booth_id: "" })} disabled={!form.district_id}>
              <option value="">Select assembly</option>
              {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Fld>
          <Fld label="Block">
            <select className={inp} value={form.ward_id} onChange={(e) => setForm({ ...form, ward_id: e.target.value, booth_id: "" })} disabled={!form.assembly_id}>
              <option value="">Select block</option>
              {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Fld>
          <Fld label="Polling Station">
            <select className={inp} value={form.booth_id} onChange={(e) => setForm({ ...form, booth_id: e.target.value })} disabled={!form.ward_id}>
              <option value="">Select polling station</option>
              {booths.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Fld>
          <Fld label="Status">
            <select className={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Fld>
          {!isEdit && (
            <div>
              <label className="text-xs text-gray-500">Activity score: {form.activity_score}</label>
              <input type="range" min="0" max="100" value={form.activity_score} onChange={(e) => setForm({ ...form, activity_score: Number(e.target.value) })} className="w-full" />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving || !form.name || uploading} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function Fld({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function EditWorkerModal({ worker, districts, designations, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(form) {
    setSaving(true); setError("");
    const r = await fetch(`/api/workers/${worker.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const d = await r.json();
    if (r.ok) onSaved(); else { setError(d.message || "Failed"); setSaving(false); }
  }

  return (
    <WorkerModal
      title="Edit Member"
      isEdit
      initial={{
        name: worker.name || "",
        mobile: worker.mobile || "",
        photo_url: worker.photo_url || "",
        position: worker.position || "",
        address: worker.address || "",
        zone_id: worker.zone_id || "",
        lok_sabha_id: worker.lok_sabha_id || "",
        district_id: worker.district_id || "",
        assembly_id: worker.assembly_id || "",
        ward_id: worker.ward_id || "",
        booth_id: worker.booth_id || "",
        status: worker.status || "active",
      }}
      districts={districts}
      designations={designations}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={error}
    />
  );
}

function AddWorkerModal({ districts, designations, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(form) {
    setSaving(true); setError("");
    const r = await fetch("/api/workers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await r.json();
    if (r.ok) onSaved(); else { setError(d.message || "Failed"); setSaving(false); }
  }

  return (
    <WorkerModal
      title="Add Worker"
      initial={{
        name: "", mobile: "", photo_url: "", position: "", skills: "", address: "",
        zone_id: "", lok_sabha_id: "", district_id: "", assembly_id: "", ward_id: "", booth_id: "",
        status: "active", activity_score: 50,
      }}
      districts={districts}
      designations={designations}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={error}
    />
  );
}
