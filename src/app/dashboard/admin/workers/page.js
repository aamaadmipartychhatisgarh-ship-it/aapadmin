"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isAdmin, canManageWorkers, isSuperAdmin } from "@/lib/permissions";
import CollapsibleSection from "@/components/CollapsibleSection";
import { AddWorkerModal, EditWorkerModal } from "@/components/WorkerModal";
import { Users, Plus, Search, Upload, Loader2, CheckCircle2, ChevronLeft, ChevronRight, Activity, Pencil, Trash2, Download, FileText } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ActionBar from "@/components/ActionBar";
import PersonDetailModal from "@/components/PersonDetailModal";
import CallActionIcons from "@/components/CallActionIcons";

export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !canManageWorkers(session)) router.push("/dashboard");
  }, [status, session, router]);
  if (status !== "authenticated" || !canManageWorkers(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body session={session} />;
}

function Body({ session }) {
  // Callers can add/edit workers; bulk imports stay admin-only; export is
  // restricted to the Super Admin.
  const canEdit = canManageWorkers(session);
  const canImport = isAdmin(session);
  const canExport = isSuperAdmin(session);
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
  const [membershipFilter, setMembershipFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [dupOnly, setDupOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [editingWorker, setEditingWorker] = useState(null);
  const [viewingWorkerId, setViewingWorkerId] = useState(null);
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
  }, [search, zoneId, lokSabhaId, districtId, assemblyId, statusFilter, membershipFilter, positionFilter, dupOnly, page]);

  // Refetch when the admin returns to this tab so worker edits made elsewhere
  // (e.g. a caller updating details in My Workplace) show without a manual refresh.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), limit: "20" });
    if (search) p.set("search", search);
    if (zoneId) p.set("zone_id", zoneId);
    if (lokSabhaId) p.set("lok_sabha_id", lokSabhaId);
    if (districtId) p.set("district_id", districtId);
    if (assemblyId) p.set("assembly_id", assemblyId);
    if (statusFilter) p.set("status", statusFilter);
    if (membershipFilter) p.set("membership_status", membershipFilter);
    if (positionFilter) p.set("position", positionFilter);
    if (dupOnly) p.set("duplicates", "1");
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
  const exportQs = ep.toString() ? `?${ep}` : "";

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Universal page header — single location for all page actions */}
      <PageHeader
        icon={Users}
        title="Workers"
        description={`${data.total} members across the organization.`}
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "People" }, { label: "Workers" }]}
        actions={
          <ActionBar items={[
            canExport && { key: "xlsx", label: "Excel", icon: Download, href: `/api/workers/export/xlsx${exportQs}` },
            canExport && { key: "pdf", label: "PDF", icon: FileText, href: `/api/workers/export/pdf${exportQs}` },
            canImport && { key: "impx", label: importing ? "Importing…" : "Import Excel", icon: Upload, variant: "success", loading: importing, onClick: () => excelRef.current?.click() },
            canImport && { key: "impc", label: "Import CSV", icon: Upload, onClick: () => fileRef.current?.click() },
            canEdit && { key: "add", label: "Add Worker", icon: Plus, variant: "primary", onClick: () => setShowAdd(true) },
          ]} />
        }
      />
      {/* Hidden file inputs driven by the header's import actions */}
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

      {/* Total matching records for the current filters/search. */}
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
                <th className="px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Mobile</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Designation</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Zone</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Lok Sabha</th>
                <th className="px-4 py-3 font-semibold text-gray-600">District</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Assembly</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Block</th>
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
                    <div
                      className="flex items-center gap-3 -m-1 p-1 rounded-lg hover:bg-blue-50"
                      onClick={(e) => { e.stopPropagation(); setViewingWorkerId(w.id); }}
                      title="View details"
                    >
                      {w.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={w.photo_url} alt="" className="w-12 h-12 rounded-full object-cover border border-gray-200 shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-[#164FA3]/10 border border-gray-200 flex items-center justify-center text-[#164FA3] text-sm font-bold shrink-0">
                          {(w.name || "?")[0].toUpperCase()}
                        </div>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate">{w.name}</span>
                        {w.membership_no && <span className="block text-[10px] text-gray-400 font-mono">{w.membership_no}{w.membership_status && w.membership_status !== "active" ? ` · ${w.membership_status}` : ""}</span>}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <span>{w.mobile || "—"}</span>
                      <CallActionIcons phone={w.mobile} personName={w.name} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{w.position || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{w.zone_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{w.lok_sabha_name || "—"}</td>
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
      {editingWorker && (
        <EditWorkerModal
          worker={editingWorker}
          districts={districts}
          designations={designations}
          onClose={() => setEditingWorker(null)}
          onSaved={() => { setEditingWorker(null); load(); }}
        />
      )}
      {viewingWorkerId && (
        <PersonDetailModal type="worker" id={viewingWorkerId} onClose={() => setViewingWorkerId(null)} />
      )}
    </div>
  );
}
