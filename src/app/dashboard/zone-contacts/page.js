"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { UserCheck, Loader2, Search, X, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Avatar from "@/components/Avatar";
import PersonDetailModal from "@/components/PersonDetailModal";
import { usePageGuard } from "@/components/usePageGuard";
import { isCaller } from "@/lib/permissions";

// Caller → Contacts: every contact of the caller's CURRENT Zone, read-only.
// The list comes from the SAME /api/contacts endpoint the Contacts module uses
// (same search / filters / sort / pagination parameters); the server confines a
// caller to their Zone (lib/callerZoneScope), re-reading the Zone on every
// request — this page never decides what the caller may see.
const PAGE_SIZES = [25, 50, 100];
const COLS = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Mobile" },
  { key: "designation", label: "Designation" },
  { key: "lok_sabha", label: "Lok Sabha" },
  { key: "district", label: "District" },
  { key: "assembly", label: "Assembly" },
  { key: null, label: "Block" },
  { key: null, label: "Assigned To" },
  { key: null, label: "Calling" },
];

export default function ZoneContactsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("zone_contacts", isCaller(session));

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [zone, setZone] = useState(null); // { zone_id, zone_name }
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [lokSabhaId, setLokSabhaId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [statusF, setStatusF] = useState("");
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 400); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { setPage(1); }, [search, lokSabhaId, districtId, assemblyId, designationId, statusF, pageSize, sortKey, sortDir]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (lokSabhaId) p.set("lok_sabha_id", lokSabhaId);
    if (districtId) p.set("district_id", districtId);
    if (assemblyId) p.set("assembly_ids", assemblyId);
    if (designationId) p.set("designation_ids", designationId);
    if (statusF) p.set("status", statusF);
    if (sortKey) { p.set("sort", sortKey); p.set("dir", sortDir); }
    p.set("page", String(page));
    p.set("page_size", String(pageSize));
    return p.toString();
  }, [search, lokSabhaId, districtId, assemblyId, designationId, statusF, sortKey, sortDir, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`/api/contacts?${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 401 ? "You do not have access to Zone Contacts." : "Could not load contacts.");
      const d = await r.json();
      setRows(d.contacts || []); setTotal(d.total || 0); setZone(d.caller_zone || null);
    } catch (e) {
      setRows([]); setTotal(0); setErr(e.message || "Could not load contacts.");
    } finally { setLoading(false); }
  }, [qs]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);
  // The Zone is re-read by the server on every request; reload when the tab
  // regains focus so a Zone change by an Admin shows up without a manual refresh.
  useEffect(() => {
    if (!allowed) return undefined;
    const onFocus = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [allowed, load]);

  // Filter options, limited to the caller's Zone.
  const zoneId = zone?.zone_id || null;
  useEffect(() => {
    if (!allowed) return;
    fetch("/api/designations").then((r) => (r.ok ? r.json() : { designations: [] })).then((d) => setDesignations(d.designations || [])).catch(() => {});
  }, [allowed]);
  useEffect(() => {
    if (!zoneId) { setLokSabhas([]); setDistricts([]); return; }
    Promise.all([
      fetch(`/api/locations?parent_id=${zoneId}`).then((r) => (r.ok ? r.json() : { locations: [] })),
      fetch("/api/locations?type=district").then((r) => (r.ok ? r.json() : { locations: [] })),
    ]).then(([under, all]) => {
      const ls = (under.locations || []).filter((l) => l.type === "lok_sabha");
      const lsIds = new Set(ls.map((l) => l.id));
      setLokSabhas(ls);
      setDistricts((all.locations || []).filter((d) => d.parent_id === zoneId || lsIds.has(d.parent_id)));
    }).catch(() => {});
    setLokSabhaId(""); setDistrictId(""); setAssemblyId("");
  }, [zoneId]);
  useEffect(() => {
    if (!districtId) { setAssemblies([]); return; }
    fetch(`/api/locations?parent_id=${districtId}`).then((r) => (r.ok ? r.json() : { locations: [] })).then((d) => setAssemblies((d.locations || []).filter((l) => l.type === "assembly"))).catch(() => {});
  }, [districtId]);
  const districtOptions = lokSabhaId ? districts.filter((d) => String(d.parent_id) === String(lokSabhaId)) : districts;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const anyFilter = !!(search || lokSabhaId || districtId || assemblyId || designationId || statusF);
  const clear = () => { setSearchInput(""); setSearch(""); setLokSabhaId(""); setDistrictId(""); setAssemblyId(""); setDesignationId(""); setStatusF(""); };
  const sortBy = (k) => { if (!k) return; if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc"); else { setSortKey(k); setSortDir("asc"); } };
  const sel = "h-10 rounded-lg border border-gray-200 text-sm px-2 bg-white";

  if (!ready || !allowed) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <PageHeader icon={UserCheck} title="Contacts" description="All contacts in your assigned Zone (view only)."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Contacts" }]} />

      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#164FA3] bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5" data-testid="zc-zone">
          <MapPin size={14} /> {zone?.zone_name ? `Zone: ${zone.zone_name}` : "No Zone assigned"}
        </span>
        <span className="text-sm text-gray-500" data-testid="zc-total">{loading ? "…" : `${Number(total).toLocaleString("en-IN")} contact${total === 1 ? "" : "s"}`}</span>
      </div>

      {!loading && !zone?.zone_id && !err && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">You have no Zone assigned yet. Ask an Admin to assign your Zone to see its contacts.</div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <label className="relative lg:col-span-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search name or mobile…" aria-label="Search"
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
          </label>
          <select aria-label="Lok Sabha" className={sel} value={lokSabhaId} onChange={(e) => { setLokSabhaId(e.target.value); setDistrictId(""); setAssemblyId(""); }}>
            <option value="">All Lok Sabha</option>
            {lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select aria-label="District" className={sel} value={districtId} onChange={(e) => { setDistrictId(e.target.value); setAssemblyId(""); }}>
            <option value="">All Districts</option>
            {districtOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select aria-label="Assembly" className={sel} value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)} disabled={!districtId}>
            <option value="">{districtId ? "All Assemblies" : "Pick a district"}</option>
            {assemblies.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select aria-label="Designation" className={sel} value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
            <option value="">All Designations</option>
            {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select aria-label="Status" className={sel} value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="done">Done</option>
            <option value="assigned">Assigned to a caller</option>
            <option value="pool">Unassigned (pool)</option>
          </select>
        </div>
        {anyFilter && <button type="button" onClick={clear} className="mt-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><X size={14} /> Clear filters</button>}
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{err}</div>}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]" data-testid="zc-table">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                {COLS.map((c) => (
                  <th key={c.label} className={`px-3 py-3 font-semibold ${c.key ? "cursor-pointer select-none hover:text-gray-800" : ""}`} onClick={() => sortBy(c.key)}>
                    <span className="inline-flex items-center gap-1">{c.label}
                      {c.key && sortKey === c.key && (sortDir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={COLS.length} className="py-12 text-center text-gray-400"><Loader2 className="inline animate-spin text-[#164FA3]" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={COLS.length} className="py-12 text-center text-gray-400">{anyFilter ? "No contacts match these filters." : "No contacts in your Zone."}</td></tr>
              ) : rows.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" data-testid="zc-row" data-id={c.id} onClick={() => setViewing(c)}>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      <Avatar name={c.person_name} src={c.photo_url} size={28} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-[10px]" />
                      <span className="font-medium text-gray-900">{c.person_name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-700">{c.phone_number}</td>
                  <td className="px-3 py-2.5 text-gray-700">{c.designation_name || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-600">{c.lok_sabha_name || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-600">{c.district_name || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-600">{c.assembly_name || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-600">{c.ward_name || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-600">{c.assigned_to_username || "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.is_completed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{c.is_completed ? "Done" : "Pending"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
          <label className="inline-flex items-center gap-2">Rows
            <select aria-label="Page size" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="h-8 rounded-md border border-gray-200 px-1.5 bg-white">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span data-testid="zc-page">Page {Math.min(page, totalPages)} of {totalPages}</span>
          <span className="inline-flex gap-2">
            <button type="button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))} className="h-8 px-2 rounded-md border border-gray-200 disabled:opacity-40"><ChevronLeft size={15} /></button>
            <button type="button" aria-label="Next page" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="h-8 px-2 rounded-md border border-gray-200 disabled:opacity-40"><ChevronRight size={15} /></button>
          </span>
        </div>
      </div>

      {viewing && <PersonDetailModal type="contact" data={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
