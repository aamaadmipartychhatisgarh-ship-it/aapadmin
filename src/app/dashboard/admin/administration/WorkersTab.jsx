"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAdmin, canManageWorkers, isSuperAdmin } from "@/lib/permissions";
import CollapsibleSection from "@/components/CollapsibleSection";
import { AddWorkerModal, EditWorkerModal } from "@/components/WorkerModal";
import { Users, Plus, Search, Upload, Loader2, CheckCircle2, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Pencil, Trash2, Download, FileText } from "lucide-react";
import ActionBar from "@/components/ActionBar";
import PersonDetailModal from "@/components/PersonDetailModal";
import CallActionIcons from "@/components/CallActionIcons";
import Avatar from "@/components/Avatar";
import WorkerActivityPanel from "@/components/administration/WorkerActivityPanel";
import ImportPreviewModal from "@/components/administration/ImportPreviewModal";
import { WORKER_TYPES, WORKER_TYPE_LABELS } from "@/lib/workerTypes";

const PAGE_SIZE = 100;

// Columns whose header can be clicked to sort — key must match a column the
// API's SORTABLE allowlist understands (src/app/api/workers/route.js).
const SORT_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "mobile", label: "Mobile" },
  { key: "position", label: "Designation" },
  { key: "worker_type", label: "Worker Type" },
  { key: "district", label: "District" },
  { key: "assembly", label: "Assembly" },
  { key: "ward", label: "Block" },
  { key: null, label: "Address" }, // not sortable — free text, low value
  { key: "activity_score", label: "Activity" },
  { key: "status", label: "Status" },
];

function pageWindow(current, total) {
  const delta = 2;
  const range = [];
  for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) range.push(i);
  if (range[0] > 1) { if (range[0] > 2) range.unshift("…"); range.unshift(1); }
  if (range[range.length - 1] < total) { if (range[range.length - 1] < total - 1) range.push("…"); range.push(total); }
  return range;
}

// Administration's "Workers" tab — worker management (the former standalone
// Workers page, unchanged) plus Worker Activity stats. Contact assignment/
// distribution lives on the Contacts page, not here — Administration is
// worker management only, no duplicate assignment panel.
export default function WorkersTab({ session }) {
  // Callers can add/edit workers; bulk imports stay admin-only; export is
  // restricted to the Super Admin.
  const canEdit = canManageWorkers(session);
  const canImport = isAdmin(session);
  const canExport = isSuperAdmin(session);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Restore filters/page/sort from the URL (?w_*) on mount, so switching to
  // the Teams/Users tab and back — which unmounts this component — or a full
  // page reload both land back exactly where the admin left off, instead of
  // resetting to page 1 with no filters.
  const initial = useRef(null);
  if (initial.current === null) {
    const sp = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    initial.current = {
      search: sp.get("w_search") || "",
      zoneId: sp.get("w_zone") || "",
      lokSabhaId: sp.get("w_ls") || "",
      districtId: sp.get("w_district") || "",
      assemblyId: sp.get("w_assembly") || "",
      statusFilter: sp.get("w_status") || "",
      membershipFilter: sp.get("w_membership") || "",
      positionFilter: sp.get("w_position") || "",
      workerTypeFilter: sp.get("w_type") || "",
      dupOnly: sp.get("w_dup") === "1",
      page: Math.max(1, parseInt(sp.get("w_page") || "1", 10) || 1),
      sort: sp.get("w_sort") || "",
      dir: sp.get("w_dir") === "asc" ? "asc" : "desc",
    };
  }

  const [data, setData] = useState({ workers: [], total: 0, page: 1, pages: 1 });
  const [districts, setDistricts] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initial.current.search);
  const [zones, setZones] = useState([]);
  const [zoneId, setZoneId] = useState(initial.current.zoneId);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [lokSabhaId, setLokSabhaId] = useState(initial.current.lokSabhaId);
  const [districtId, setDistrictId] = useState(initial.current.districtId);
  const [assemblies, setAssemblies] = useState([]);
  const [assemblyId, setAssemblyId] = useState(initial.current.assemblyId);
  const [statusFilter, setStatusFilter] = useState(initial.current.statusFilter);
  const [membershipFilter, setMembershipFilter] = useState(initial.current.membershipFilter);
  const [positionFilter, setPositionFilter] = useState(initial.current.positionFilter);
  const [workerTypeFilter, setWorkerTypeFilter] = useState(initial.current.workerTypeFilter);
  const [dupOnly, setDupOnly] = useState(initial.current.dupOnly);
  const [page, setPage] = useState(initial.current.page);
  const [sort, setSort] = useState(initial.current.sort);
  const [dir, setDir] = useState(initial.current.dir);
  const [showAdd, setShowAdd] = useState(false);
  const [editingWorker, setEditingWorker] = useState(null);
  const [viewingWorkerId, setViewingWorkerId] = useState(null);
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null); // import-preview response, or null
  const fileRef = useRef(null);
  const excelRef = useRef(null);

  useEffect(() => {
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || []));
  }, []);

  // Lok Sabha options follow the selected zone (all when no zone picked).
  // Guarded so restoring zoneId from the URL on mount doesn't immediately
  // wipe out a restored lokSabhaId too.
  const zoneMounted = useRef(false);
  useEffect(() => {
    const url = zoneId ? `/api/locations?parent_id=${zoneId}` : "/api/locations?type=lok_sabha";
    fetch(url).then((r) => r.json()).then((d) => setLokSabhas(d.locations || []));
    if (zoneMounted.current) setLokSabhaId("");
    zoneMounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId]);

  // Assembly filter is independent of district: imported workers can carry an
  // assembly without a matching district, so requiring a district first made
  // assembly-wise search miss them. Show all assemblies unless a district is
  // picked (then narrow the options to that district's assemblies). Guarded
  // the same way as the zone effect above.
  const districtMounted = useRef(false);
  useEffect(() => {
    const url = districtId ? `/api/locations?parent_id=${districtId}` : "/api/locations?type=assembly";
    fetch(url).then((r) => r.json()).then((d) => setAssemblies(d.locations || []));
    if (districtMounted.current) setAssemblyId("");
    districtMounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [districtId]);

  useEffect(() => {
    const t = setTimeout(() => { load(); syncUrl(); }, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, zoneId, lokSabhaId, districtId, assemblyId, statusFilter, membershipFilter, positionFilter, workerTypeFilter, dupOnly, page, sort, dir]);

  // Refetch when the admin returns to this tab so worker edits made elsewhere
  // (e.g. a caller updating details in My Workplace) show without a manual refresh.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the current filters/page/sort onto the URL (?w_*) — the "memory"
  // that survives a tab switch or a reload. Uses replace() so typing in
  // Search doesn't spam browser history.
  function syncUrl() {
    const p = new URLSearchParams(Array.from(searchParams.entries()));
    const set = (k, v) => { if (v) p.set(k, v); else p.delete(k); };
    set("w_search", search);
    set("w_zone", zoneId);
    set("w_ls", lokSabhaId);
    set("w_district", districtId);
    set("w_assembly", assemblyId);
    set("w_status", statusFilter);
    set("w_membership", membershipFilter);
    set("w_position", positionFilter);
    set("w_type", workerTypeFilter);
    set("w_dup", dupOnly ? "1" : "");
    set("w_page", page > 1 ? String(page) : "");
    set("w_sort", sort);
    set("w_dir", sort ? dir : "");
    const qs = p.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
  }

  function toggleSort(key) {
    if (!key) return;
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(key); setDir("asc"); }
    setPage(1);
  }

  async function load() {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (search) p.set("search", search);
    if (zoneId) p.set("zone_id", zoneId);
    if (lokSabhaId) p.set("lok_sabha_id", lokSabhaId);
    if (districtId) p.set("district_id", districtId);
    if (assemblyId) p.set("assembly_id", assemblyId);
    if (statusFilter) p.set("status", statusFilter);
    if (membershipFilter) p.set("membership_status", membershipFilter);
    if (positionFilter) p.set("position", positionFilter);
    if (workerTypeFilter) p.set("worker_type", workerTypeFilter);
    if (dupOnly) p.set("duplicates", "1");
    if (sort) { p.set("sort", sort); p.set("dir", dir); }
    const r = await fetch(`/api/workers?${p}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }

  async function removeWorker(w) {
    if (!confirm(`Delete worker "${w.name}"${w.mobile ? ` (${w.mobile})` : ""}? This cannot be undone.`)) return;
    const r = await fetch(`/api/workers/${w.id}`, { method: "DELETE" });
    if (r.ok) { setMessage(`Deleted ${w.name}.`); load(); }
    else { const d = await r.json().catch(() => ({})); setMessage(d.message || "Delete failed"); }
  }

  async function uploadCsv(file) {
    setMessage("");
    const text = await file.text();
    const r = await fetch("/api/workers/upload-csv", { method: "POST", headers: { "Content-Type": "text/csv" }, body: text });
    const d = await r.json();
    if (r.ok) { setMessage(`Imported ${d.inserted} workers.`); load(); }
    else setMessage(d.message || "Upload failed");
  }

  // Import from an Excel (.xlsx/.xls/.csv) file. Step 1: parse + validate
  // WITHOUT writing anything, and show a preview (valid/invalid counts, a
  // sample of row errors, a downloadable full error report). The admin
  // confirms from the preview modal before anything is committed.
  async function importExcel(file) {
    setMessage("");
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/workers/import-excel?dry_run=1", { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok) setPreview({ ...d, file });
      else setMessage(d.message || "Import failed");
    } catch {
      setMessage("Import failed — file too large or network error.");
    } finally {
      setImporting(false);
      if (excelRef.current) excelRef.current.value = "";
    }
  }

  // Export links carry the current filters so the download matches the view.
  const ep = new URLSearchParams();
  if (search) ep.set("search", search);
  if (zoneId) ep.set("zone_id", zoneId);
  if (lokSabhaId) ep.set("lok_sabha_id", lokSabhaId);
  if (districtId) ep.set("district_id", districtId);
  if (assemblyId) ep.set("assembly_id", assemblyId);
  if (statusFilter) ep.set("status", statusFilter);
  if (membershipFilter) ep.set("membership_status", membershipFilter);
  if (positionFilter) ep.set("position", positionFilter);
  if (workerTypeFilter) ep.set("worker_type", workerTypeFilter);
  const exportQs = ep.toString() ? `?${ep}` : "";

  return (
    <div className="space-y-10">
      {/* -------------------------------------------------- Worker Management */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-bold text-gray-900">Worker Management</h2>
          <ActionBar items={[
            canExport && { key: "xlsx", label: "Excel", icon: Download, href: `/api/workers/export/xlsx${exportQs}` },
            canExport && { key: "pdf", label: "PDF", icon: FileText, href: `/api/workers/export/pdf${exportQs}` },
            canImport && { key: "impx", label: importing ? "Checking…" : "Import Excel", icon: Upload, variant: "success", loading: importing, onClick: () => excelRef.current?.click() },
            canImport && { key: "impc", label: "Import CSV", icon: Upload, onClick: () => fileRef.current?.click() },
            canEdit && { key: "add", label: "Add Worker", icon: Plus, variant: "primary", onClick: () => setShowAdd(true) },
          ]} />
        </div>

        <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => e.target.files?.[0] && importExcel(e.target.files[0])} />
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])} />

        {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center gap-2"><CheckCircle2 size={16} />{message}</div>}

        <CollapsibleSection title="Search & Filters">
        <div className="flex items-center gap-3 flex-wrap">
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
          <select value={workerTypeFilter} onChange={(e) => { setWorkerTypeFilter(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-sm">
            <option value="">All worker types</option>
            {WORKER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-sm">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
          </select>
          <select value={membershipFilter} onChange={(e) => { setMembershipFilter(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-sm">
            <option value="">All memberships</option>
            <option value="active">Members: Active</option>
            <option value="prospect">Members: Prospect</option>
            <option value="lapsed">Members: Lapsed</option>
          </select>
          <button onClick={() => { setDupOnly(!dupOnly); setPage(1); }} className={`h-9 px-3 rounded-lg text-xs font-semibold uppercase ${dupOnly ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            Duplicates
          </button>
        </div>
        </CollapsibleSection>

        {!loading && (
          <p className="text-sm font-medium text-gray-500 mt-2.5 mb-3">
            Showing {data.total.toLocaleString()} {data.total === 1 ? "Worker" : "Workers"}
          </p>
        )}

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
                  {SORT_COLUMNS.map((c) => (
                    <th key={c.label} className="px-4 py-3 font-semibold text-gray-600 select-none whitespace-nowrap">
                      {c.key ? (
                        <button onClick={() => toggleSort(c.key)} className={`inline-flex items-center gap-1 hover:text-gray-900 ${sort === c.key ? "text-[#164FA3]" : ""}`}>
                          {c.label}
                          {sort === c.key && (dir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                  {canEdit && <th className="px-4 py-3 font-semibold text-gray-600 text-right">Edit</th>}
                </tr>
              </thead>
              <tbody>
                {data.workers.map((w) => (
                  <tr key={w.id} className="border-t border-gray-100 hover:bg-blue-50/30 cursor-pointer" onClick={() => location.href = `/dashboard/admin/workers/${w.id}`}>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div
                        className="flex items-center gap-3 -m-1 p-1 rounded-lg hover:bg-blue-50"
                        onClick={(e) => { e.stopPropagation(); setViewingWorkerId(w.id); }}
                        title="View details"
                      >
                        <Avatar name={w.name} src={w.photo_url} size={48} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]" />
                        <span className="min-w-0">
                          <span className="block truncate">{w.name}</span>
                          {w.membership_no && <span className="block text-[10px] text-gray-400 font-mono">{w.membership_no}{w.membership_status && w.membership_status !== "active" ? ` · ${w.membership_status}` : ""}</span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <span>{w.mobile || "—"}</span>
                        <CallActionIcons phone={w.mobile} personName={w.name} workerId={w.id} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{w.position || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{WORKER_TYPE_LABELS[w.worker_type] || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{w.district_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{w.assembly_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{w.ward_name || "—"}</td>
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
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ${w.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${w.status === "active" ? "bg-emerald-500" : "bg-amber-500"}`} />
                        {w.status === "active" ? "Active" : "Pending"}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {/* Edit inline in a modal so the list's filters, page and
                            scroll position are all preserved after saving. */}
                        <button onClick={(e) => { e.stopPropagation(); setEditingWorker(w); }} className="inline-flex items-center gap-1 text-xs text-[#164FA3] hover:bg-blue-50 px-2 py-1 rounded-lg font-medium">
                          <Pencil size={14} /> Edit
                        </button>
                        {canImport && (
                          <button onClick={(e) => { e.stopPropagation(); removeWorker(w); }} className="inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg font-medium">
                            <Trash2 size={14} /> Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {!loading && data.pages > 1 && (
            <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm bg-gray-50 flex-wrap gap-2">
              <span className="text-gray-500">
                Showing {((data.page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(data.page * PAGE_SIZE, data.total).toLocaleString()} of {data.total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => setPage(1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 text-xs font-medium">First</button>
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40"><ChevronLeft size={16} /></button>
                {pageWindow(data.page, data.pages).map((p, i) => p === "…" ? (
                  <span key={`e${i}`} className="px-1.5 text-gray-400">…</span>
                ) : (
                  <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 rounded text-xs font-semibold ${p === data.page ? "bg-[#164FA3] text-white" : "border border-gray-200 text-gray-600 hover:bg-gray-100"}`}>{p}</button>
                ))}
                <button disabled={page >= data.pages} onClick={() => setPage(page + 1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40"><ChevronRight size={16} /></button>
                <button disabled={page >= data.pages} onClick={() => setPage(data.pages)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 text-xs font-medium">Last</button>
              </div>
            </div>
          )}
        </div>

        {showAdd && <AddWorkerModal districts={districts} designations={designations} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
        {editingWorker && (
          <EditWorkerModal
            worker={editingWorker}
            districts={districts}
            designations={designations}
            onClose={() => setEditingWorker(null)}
            onSaved={(updatedWorker) => {
              setEditingWorker(null);
              setData((prev) => ({
                ...prev,
                workers: prev.workers.map((w) => (w.id === updatedWorker.id ? { ...w, ...updatedWorker } : w)),
              }));
              setMessage("Worker updated successfully.");
            }}
          />
        )}
        {viewingWorkerId && (
          <PersonDetailModal type="worker" id={viewingWorkerId} onClose={() => setViewingWorkerId(null)} />
        )}
        {preview && (
          <ImportPreviewModal
            preview={preview}
            onClose={() => setPreview(null)}
            onImported={(d) => {
              setPreview(null);
              let msg = `Members: ${d.workers_inserted} new, ${d.workers_updated} updated → Contacts: ${d.contacts_inserted} new, ${d.contacts_updated} updated.`;
              const skipped = d.row_errors?.filter((e) => e.severity === "error").length || 0;
              const warned = d.row_errors?.filter((e) => e.severity === "warning").length || 0;
              if (skipped) msg += ` ${skipped} row(s) skipped — see the error report.`;
              if (warned) msg += ` ${warned} row(s) imported with a warning (unresolved geo/designation) — see the error report.`;
              setMessage(msg);
              load();
            }}
          />
        )}
      </section>

      <div className="border-t border-gray-200" />

      {/* ----------------------------------------------------- Worker Activity */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Worker Activity</h2>
        <WorkerActivityPanel />
      </section>
    </div>
  );
}
