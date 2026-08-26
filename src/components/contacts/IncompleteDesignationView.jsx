"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search, Loader2, Pencil, RotateCcw } from "lucide-react";
import PersonDetailModal from "@/components/PersonDetailModal";

// CONTACTS → INCOMPLETE DESIGNATION — a database-driven filtered VIEW of the
// existing contacts whose Designation / hierarchy data is incomplete. No copy
// table: it reads /api/contacts/incomplete (the same contact records) and edits
// them through the SAME contact edit modal, so completing the data removes the
// contact from this list automatically. Admin-gated by the page + API.
const PAGE_SIZE = 50;

const MISSING_OPTIONS = [
  { v: "", l: "Any incomplete data" },
  { v: "designation", l: "Missing Designation" },
  { v: "zone", l: "Missing Zone" },
  { v: "lok_sabha", l: "Missing Lok Sabha" },
  { v: "district", l: "Missing District" },
  { v: "assembly", l: "Missing Vidhan Sabha / Assembly" },
];

const inp = "h-9 px-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 outline-none focus:border-[#164FA3] focus:ring-1 focus:ring-[#164FA3]";

export default function IncompleteDesignationView() {
  const [data, setData] = useState({ contacts: [], total: 0, counts: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState("");
  const [missing, setMissing] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [lokSabhaId, setLokSabhaId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [assemblyId, setAssemblyId] = useState("");

  // Filter option sources (live from master/contact data — nothing hardcoded).
  const [designations, setDesignations] = useState([]);
  const [users, setUsers] = useState([]);
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);

  const [editing, setEditing] = useState(null); // contact being edited

  // Debounced search so typing doesn't hammer the API.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search.trim()), 350); return () => clearTimeout(t); }, [search]);

  // Master lists on mount.
  useEffect(() => {
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || [])).catch(() => {});
    fetch("/api/users").then((r) => (r.ok ? r.json() : { users: [] })).then((d) => setUsers(d.users || [])).catch(() => {});
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || [])).catch(() => {});
  }, []);

  // Dependent filters (§4): Zone → Lok Sabha → District → Assembly. Each level
  // loads from the selected parent; changing a parent clears the children.
  useEffect(() => {
    const url = zoneId ? `/api/locations?parent_id=${zoneId}` : "/api/locations?type=lok_sabha";
    fetch(url).then((r) => r.json()).then((d) => setLokSabhas((d.locations || []).filter((l) => l.type === "lok_sabha"))).catch(() => {});
    setLokSabhaId(""); setDistricts([]); setDistrictId(""); setAssemblies([]); setAssemblyId("");
  }, [zoneId]);
  useEffect(() => {
    const url = lokSabhaId ? `/api/locations?parent_id=${lokSabhaId}` : "/api/locations?type=district";
    fetch(url).then((r) => r.json()).then((d) => setDistricts((d.locations || []).filter((l) => l.type === "district"))).catch(() => {});
    setDistrictId(""); setAssemblies([]); setAssemblyId("");
  }, [lokSabhaId]);
  useEffect(() => {
    if (!districtId) { setAssemblies([]); setAssemblyId(""); return; }
    fetch(`/api/locations?parent_id=${districtId}`).then((r) => r.json()).then((d) => setAssemblies((d.locations || []).filter((l) => l.type === "assembly"))).catch(() => {});
    setAssemblyId("");
  }, [districtId]);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (debouncedSearch) p.set("search", debouncedSearch);
    if (missing) p.set("missing", missing);
    if (designationId) p.set("designation_id", designationId);
    if (zoneId) p.set("zone_id", zoneId);
    if (lokSabhaId) p.set("lok_sabha_id", lokSabhaId);
    if (districtId) p.set("district_id", districtId);
    if (assemblyId) p.set("assembly_id", assemblyId);
    fetch(`/api/contacts/incomplete?${p}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load."))))
      .then((d) => { setData(d); setError(""); })
      .catch((e) => setError(e.message || "Failed to load."))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, missing, designationId, zoneId, lokSabhaId, districtId, assemblyId]);

  useEffect(() => { load(); }, [load]);
  // Any filter change returns to page 1.
  useEffect(() => { setPage(1); }, [debouncedSearch, missing, designationId, zoneId, lokSabhaId, districtId, assemblyId]);

  const counts = data.counts || {};
  const contacts = data.contacts || [];
  const totalPages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));

  const anyFilter = search || missing || designationId || zoneId || lokSabhaId || districtId || assemblyId;
  const clearAll = () => { setSearch(""); setMissing(""); setDesignationId(""); setZoneId(""); setLokSabhaId(""); setDistrictId(""); setAssemblyId(""); };

  const countCards = useMemo(() => ([
    { label: "Total Incomplete", value: counts.total, tone: "bg-[#164FA3] text-white", sub: "unique contacts" },
    { label: "Missing Designation", value: counts.missing_designation },
    { label: "Missing Zone", value: counts.missing_zone },
    { label: "Missing Lok Sabha", value: counts.missing_lok_sabha },
    { label: "Missing District", value: counts.missing_district },
    { label: "Missing Assembly", value: counts.missing_assembly },
  ]), [counts]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center"><AlertTriangle size={18} /></div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Incomplete Designation</h2>
          <p className="text-sm text-gray-500">Contacts whose Designation or hierarchy (Zone / Lok Sabha / District / Assembly) is missing — live from the database.</p>
        </div>
      </div>

      {/* Dynamic count cards (§10) — from actual DB records. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {countCards.map((c) => (
          <div key={c.label} className={`rounded-xl p-3.5 shadow-sm border ${c.tone || "bg-white border-gray-100"}`}>
            <div className={`text-2xl font-bold tabular-nums ${c.tone ? "" : "text-gray-900"}`}>{c.value != null ? Number(c.value).toLocaleString() : "—"}</div>
            <div className={`text-[11px] font-medium mt-0.5 ${c.tone ? "text-blue-100" : "text-gray-500"}`}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Filter section (§3/§4/§5/§9) */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className={`${inp} w-full pl-8`} placeholder="Name or phone number…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="min-w-[190px]">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Missing Field</label>
            <select className={`${inp} w-full`} value={missing} onChange={(e) => setMissing(e.target.value)}>
              {MISSING_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          <div className="min-w-[170px]">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Designation</label>
            <select className={`${inp} w-full`} value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
              <option value="">All designations</option>
              {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[150px]">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Zone</label>
            <select className={`${inp} w-full`} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              <option value="">All zones</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <div className="min-w-[150px]">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Lok Sabha</label>
            <select className={`${inp} w-full`} value={lokSabhaId} onChange={(e) => setLokSabhaId(e.target.value)}>
              <option value="">All Lok Sabha</option>
              {lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="min-w-[150px]">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">District</label>
            <select className={`${inp} w-full`} value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
              <option value="">All districts</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="min-w-[150px]">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Vidhan Sabha</label>
            <select className={`${inp} w-full`} value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)} disabled={!districtId}>
              <option value="">All assemblies</option>
              {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {anyFilter && (
            <button onClick={clearAll} className="h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1.5">
              <RotateCcw size={14} /> Clear
            </button>
          )}
          <div className="ml-auto text-sm text-gray-500 self-center">
            {loading ? <span className="inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Loading…</span>
              : <><strong className="text-gray-900">{(data.total || 0).toLocaleString()}</strong> contact{data.total === 1 ? "" : "s"}</>}
          </div>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2.5 text-sm">{error}</div>}

      {/* Contact list (§6/§7) */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>{["Name", "Phone", "Designation", "Zone", "Lok Sabha", "District", "Vidhan Sabha", "Block", "Address", "Status", "Assigned To", "Missing Information", "Action"].map((h) => (
                <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && contacts.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-gray-400"><Loader2 className="inline animate-spin" /></td></tr>
              ) : contacts.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-gray-400">No incomplete contacts for this selection.</td></tr>
              ) : contacts.map((c) => {
                const miss = new Set(c.missing_fields || []);
                const cell = (label, value) => miss.has(label)
                  ? <span className="text-red-600 font-medium">— Missing —</span>
                  : <span className="text-gray-700">{value || "—"}</span>;
                return (
                  <tr key={c.id} className="hover:bg-gray-50 align-top">
                    <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{c.person_name}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{c.phone_number}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{cell("Designation", c.designation_name)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{cell("Zone", c.zone_name)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{cell("Lok Sabha", c.lok_sabha_name)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{cell("District", c.district_name)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{cell("Assembly", c.assembly_name)}</td>
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{c.ward_name || "—"}</td>
                    <td className="px-3 py-2.5 text-gray-600 max-w-[16rem] truncate" title={c.address || ""}>{c.address || "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.is_completed ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{c.is_completed ? "Done" : "Pending"}</span></td>
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{c.assigned_to_username || <span className="text-gray-400">Pool</span>}</td>
                    <td className="px-3 py-2.5">
                      {(c.missing_fields || []).length ? (
                        <span className="inline-flex flex-wrap gap-1">
                          {c.missing_fields.map((m) => <span key={m} className="text-[10px] font-semibold bg-red-50 text-red-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">{m}</span>)}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <button onClick={() => setEditing(c)} className="inline-flex items-center gap-1 text-xs font-bold text-[#164FA3] hover:bg-[#164FA3]/10 px-2.5 py-1 rounded-lg"><Pencil size={13} /> Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Prev</button>
          <span className="text-gray-500">Page <strong className="text-gray-900">{page}</strong> of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Next</button>
        </div>
      )}

      {/* Edit → the SAME contact edit modal (§11). On save, reload the list +
          counts (§12): a now-complete contact drops off automatically because it
          no longer matches the incomplete filter. */}
      {editing && (
        <PersonDetailModal
          type="contact"
          data={editing}
          onClose={() => setEditing(null)}
          canEdit
          canEditGeo
          canEditStatus
          contactUrl="/api/contacts"
          photoUrl="/api/uploads"
          users={users}
          designations={designations}
          onSaved={(updated) => { setEditing(updated); load(); }}
        />
      )}
    </div>
  );
}
