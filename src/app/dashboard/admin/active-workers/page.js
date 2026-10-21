"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Users, Loader2, ChevronDown, ChevronRight, Phone, FileDown, Search, X } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Avatar from "@/components/Avatar";
import { isAdmin } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";
import { ACTIVE_STATUS_OPTIONS, ACTIVE_STATUS_LABEL, normalizeActiveStatus } from "@/lib/activeStatus";

// Badge colours for the four canonical Active Status values (Very Active / Active
// stand out clearly). Unset → a plain "Not set" chip.
const STATUS_STYLE = {
  VERY_ACTIVE: "bg-emerald-100 text-emerald-700",
  ACTIVE: "bg-blue-100 text-blue-700",
  AVERAGE: "bg-amber-100 text-amber-700",
  NOT_ACTIVE: "bg-gray-100 text-gray-500",
};

// Contacts → Active Workers. "Active worker" = a contact assigned to a caller and
// still reachable (not a wrong number); grouped user-wise by that caller. Counts
// come from a backend aggregate (whole authorized dataset, not a page); each
// caller expands to their contacts via the existing /api/contacts endpoint, so
// role/territory scope and permissions are exactly the Contacts module's.
export default function ActiveWorkersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("contacts", isAdmin(session));

  const [groups, setGroups] = useState([]);
  const [total, setTotal] = useState(0);
  const [callers, setCallers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null); // user_id currently expanded
  const [statusTotals, setStatusTotals] = useState({});
  // Selected Worker Status card ("" = complete view). Filtering is server-side.
  const [workerStatus, setWorkerStatus] = useState("");
  // Filters + search (all server-side; the same set drives the list, every expanded
  // caller and the PDF export, so the file always matches what is on screen).
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState("");

  // The page's filters as a query string (shared by list, expand and export).
  const filterQs = useMemo(() => {
    const p = new URLSearchParams();
    if (workerStatus) p.set("worker_status", workerStatus);
    if (search) p.set("search", search);
    if (districtId) p.set("district_id", districtId);
    if (assemblyId) p.set("assembly_id", assemblyId);
    if (blockId) p.set("block_id", blockId);
    if (designationId) p.set("designation_id", designationId);
    return p.toString();
  }, [workerStatus, search, districtId, assemblyId, blockId, designationId]);
  const anyFilter = !!(search || districtId || assemblyId || blockId || designationId);

  // Debounced search (applies 400 ms after typing stops).
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Option lists (Master Data). Assemblies follow the District; Blocks the Assembly.
  useEffect(() => {
    if (!allowed) return;
    fetch("/api/locations?type=district").then((r) => (r.ok ? r.json() : { locations: [] })).then((d) => setDistricts(d.locations || [])).catch(() => {});
    fetch("/api/designations").then((r) => (r.ok ? r.json() : { designations: [] })).then((d) => setDesignations(d.designations || [])).catch(() => {});
  }, [allowed]);
  useEffect(() => {
    if (!allowed) return;
    const url = districtId ? `/api/locations?parent_id=${encodeURIComponent(districtId)}` : "/api/locations?type=assembly";
    fetch(url).then((r) => (r.ok ? r.json() : { locations: [] })).then((d) => setAssemblies((d.locations || []).filter((l) => l.type === "assembly"))).catch(() => {});
  }, [allowed, districtId]);
  useEffect(() => {
    if (!allowed) return;
    const url = assemblyId ? `/api/locations?parent_id=${encodeURIComponent(assemblyId)}` : "/api/locations?type=ward";
    fetch(url).then((r) => (r.ok ? r.json() : { locations: [] })).then((d) => setBlocks((d.locations || []).filter((l) => l.type === "ward"))).catch(() => {});
  }, [allowed, assemblyId]);

  const clearFilters = () => {
    setExpanded(null); setSearchInput(""); setSearch(""); setDistrictId(""); setAssemblyId(""); setBlockId(""); setDesignationId("");
  };

  // Export every matching worker (all callers, all rows — not just what is
  // expanded) as a PDF, with exactly the filters above.
  const exportPdf = async () => {
    setExporting(true); setExportErr("");
    try {
      const r = await fetch(`/api/contacts/active-workers/export?format=pdf${filterQs ? `&${filterQs}` : ""}`, { cache: "no-store" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.message || "Export failed.");
      }
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition") || "";
      const name = (cd.match(/filename="([^"]+)"/) || [])[1] || "Active_Workers.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setExportErr(e.message || "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/contacts/active-workers${filterQs ? `?${filterQs}` : ""}`, { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        setGroups(d.groups || []);
        setStatusTotals(d.status_totals || {});
        setTotal(d.total || 0);
        setCallers(d.callers || 0);
      }
    } finally { setLoading(false); }
  }, [filterQs]);

  useEffect(() => {
    if (!allowed) return;
    load();
  }, [allowed, load]);

  // Persist a worker's Active Status to the backend (users.active_status) and
  // reflect it locally — the value survives refresh/relogin because it is stored,
  // never kept only in React state.
  const saveStatus = useCallback(async (userId, value) => {
    // Optimistic; revert on failure.
    setGroups((gs) => gs.map((g) => (g.user_id === userId ? { ...g, active_status: value, _saving: true } : g)));
    try {
      const r = await fetch("/api/contacts/active-workers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, active_status: value }),
      });
      const d = await r.json().catch(() => ({}));
      setGroups((gs) => gs.map((g) => (g.user_id === userId
        ? { ...g, active_status: r.ok ? (d.active_status || value) : g.active_status, _saving: false }
        : g)));
    } catch {
      setGroups((gs) => gs.map((g) => (g.user_id === userId ? { ...g, _saving: false } : g)));
    }
  }, []);

  const visibleGroups = groups;

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={Users}
        title="Active Workers"
        description="Assigned, still-reachable contacts grouped by the caller who owns them."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Contacts", href: "/dashboard/admin/contacts" }, { label: "Active Workers" }]}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <SumCard label="Active Workers" value={Number(total).toLocaleString("en-IN")} accent />
        <SumCard label="Callers" value={Number(callers).toLocaleString("en-IN")} />
        <SumCard label="Avg per Caller" value={callers ? Math.round(total / callers).toLocaleString("en-IN") : "—"} />
      </div>

      {/* Worker Status cards — counts of the stored contacts.active_status, summed
          over the whole authorized dataset. Only the four canonical statuses;
          contacts with no status set are deliberately not counted here. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {ACTIVE_STATUS_OPTIONS.map((o) => {
          const on = workerStatus === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => { setExpanded(null); setWorkerStatus(on ? "" : o.value); }}
              className={`text-left rounded-2xl border shadow-sm p-4 transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#164FA3] ${STATUS_STYLE[o.value]} ${on ? "border-[#164FA3] ring-2 ring-[#164FA3]" : "border-gray-100"} ${workerStatus && !on ? "opacity-60" : ""}`}
            >
              <div className="text-xs font-semibold uppercase tracking-wide opacity-80">{o.label}</div>
              <div className="text-3xl font-bold mt-1">{Number(statusTotals[o.value] || 0).toLocaleString("en-IN")}</div>
            </button>
          );
        })}
      </div>

      {/* Filters + search + export */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4" data-testid="aw-filters">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <label className="relative lg:col-span-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchInput} onChange={(e) => { setExpanded(null); setSearchInput(e.target.value); }} placeholder="Search worker name, mobile or caller…" aria-label="Search"
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
          </label>
          <select aria-label="District" value={districtId} onChange={(e) => { setExpanded(null); setDistrictId(e.target.value); setAssemblyId(""); setBlockId(""); }} className="h-10 rounded-lg border border-gray-200 text-sm px-2 bg-white">
            <option value="">All Districts</option>
            {districts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select aria-label="Assembly" value={assemblyId} onChange={(e) => { setExpanded(null); setAssemblyId(e.target.value); setBlockId(""); }} className="h-10 rounded-lg border border-gray-200 text-sm px-2 bg-white">
            <option value="">All Assemblies</option>
            {assemblies.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select aria-label="Block" value={blockId} onChange={(e) => { setExpanded(null); setBlockId(e.target.value); }} className="h-10 rounded-lg border border-gray-200 text-sm px-2 bg-white">
            <option value="">All Blocks</option>
            {blocks.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select aria-label="Designation" value={designationId} onChange={(e) => { setExpanded(null); setDesignationId(e.target.value); }} className="h-10 rounded-lg border border-gray-200 text-sm px-2 bg-white">
            <option value="">All Designations</option>
            {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          {anyFilter && (
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><X size={14} /> Clear filters</button>
          )}
          {exportErr && <span className="text-sm text-red-600" role="alert">{exportErr}</span>}
          <button type="button" onClick={exportPdf} disabled={exporting || loading || total === 0}
            className="ml-auto inline-flex items-center gap-2 h-10 px-4 rounded-lg text-white text-sm font-semibold bg-[#164FA3] hover:bg-[#123f82] disabled:opacity-50">
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />} Export PDF
          </button>
        </div>
      </div>

      {workerStatus && (
        <div className="flex items-center justify-between gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 text-sm text-[#164FA3]">
          <span>Showing only <b>{ACTIVE_STATUS_LABEL[workerStatus]}</b> workers ({Number(total).toLocaleString("en-IN")})</span>
          <button type="button" onClick={() => { setExpanded(null); setWorkerStatus(""); }} className="font-semibold hover:underline">Show all Active Workers</button>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-400"><Loader2 className="inline animate-spin text-[#164FA3]" /></div>
        ) : visibleGroups.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            {workerStatus ? `No ${ACTIVE_STATUS_LABEL[workerStatus]} workers found for your access${anyFilter ? " and filters" : ""}.` : anyFilter ? "No active workers match these filters." : "No active workers found for your access."}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visibleGroups.map((g) => (
              <li key={g.user_id}>
                <div className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50">
                  <button
                    onClick={() => setExpanded(expanded === g.user_id ? null : g.user_id)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    {expanded === g.user_id ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
                    <Avatar name={g.username} size={30} className="bg-[#164FA3]/10 border border-gray-200 shrink-0" textClassName="text-[#164FA3] text-[11px]" />
                    <span className="font-semibold text-gray-900 truncate">{g.username}</span>
                  </button>
                  <div className="flex items-center gap-2 text-xs shrink-0">
                    {/* Active Status — VIEW + ADD/UPDATE here (the authoritative place). */}
                    <StatusControl group={g} onChange={(v) => saveStatus(g.user_id, v)} />
                    {/* Worker Status breakdown of this caller's contacts (stored per contact). */}
                    <WorkerStatusChips counts={g.worker_status_counts} />
                    <span className="text-gray-400 hidden md:inline">{g.pending_count} pending · {g.done_count} done</span>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#164FA3] text-white font-bold">{Number(g.active_count).toLocaleString("en-IN")}</span>
                  </div>
                </div>
                {expanded === g.user_id && <CallerContacts userId={g.user_id} filterQs={filterQs} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// The workers assigned to one caller — the caller's COMPLETE list (no page cap)
// for the page's current filters, from the same query the counts and the PDF use.
function CallerContacts({ userId, filterQs }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/contacts/active-workers?list=1&user_id=${encodeURIComponent(userId)}${filterQs ? `&${filterQs}` : ""}`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : { contacts: [] })
      .then((d) => { if (alive) setRows(d.contacts || []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [userId, filterQs]);

  if (rows === null) return <div className="px-6 py-4 text-sm text-gray-400"><Loader2 className="inline animate-spin text-[#164FA3]" size={14} /> Loading…</div>;
  if (rows.length === 0) return <div className="px-6 py-4 text-sm text-gray-400">No contacts.</div>;
  return (
    <div className="bg-gray-50/60 px-4 pb-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr><th className="px-3 py-2 font-semibold">Name</th><th className="px-3 py-2 font-semibold">Phone</th><th className="px-3 py-2 font-semibold">Designation</th><th className="px-3 py-2 font-semibold">Location</th><th className="px-3 py-2 font-semibold">Worker Status</th><th className="px-3 py-2 font-semibold">Calling</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={c.person_name} src={c.photo_url} size={24} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-[10px]" />
                    <span className="font-medium text-gray-900">{c.person_name}</span>
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap"><Phone size={11} className="inline mr-1 text-gray-400" />{c.phone_number}</td>
                <td className="px-3 py-2 text-gray-700">{c.designation_name || "—"}</td>
                <td className="px-3 py-2 text-gray-500 text-xs">{[c.district_name, c.assembly_name, c.block_name].filter(Boolean).join(" / ") || "—"}</td>
                <td className="px-3 py-2"><WorkerStatusBadge value={c.active_status} /></td>
                <td className="px-3 py-2">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.is_completed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{c.is_completed ? "Done" : "Pending"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// One worker's Active Status: a colour-coded badge (Very Active / Active stand
// out) plus the picker to add/update it. The change is saved to the backend, so
// it persists across refresh/relogin and is the same value the Log Outcome reads.
function StatusControl({ group, onChange }) {
  const val = group.active_status || "";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`px-2 py-0.5 rounded-full font-semibold ${val ? STATUS_STYLE[val] : "bg-gray-100 text-gray-400"}`}>
        {val ? ACTIVE_STATUS_LABEL[val] : "Not set"}
      </span>
      <select
        value={val}
        onChange={(e) => onChange(e.target.value)}
        disabled={group._saving}
        aria-label={`Set active status for ${group.username}`}
        className="h-7 rounded-md border border-gray-200 bg-white text-[11px] font-semibold text-gray-600 px-1.5 outline-none focus:ring-2 focus:ring-[#164FA3] disabled:opacity-60"
      >
        <option value="" disabled>Set…</option>
        {ACTIVE_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

function SumCard({ label, value, accent }) {
  return (
    <div className={`${accent ? "bg-[#164FA3] text-white" : "bg-white border border-gray-100"} rounded-xl p-4 shadow-sm`}>
      <div className={`text-2xl font-bold ${accent ? "" : "text-gray-900"}`}>{value}</div>
      <div className={`text-xs font-medium mt-1 ${accent ? "text-blue-200" : "text-gray-500"}`}>{label}</div>
    </div>
  );
}

// The worker's stored status (contacts.active_status) as a badge. Anything that is
// not one of the four canonical values — including "not rated yet" — renders as
// "Not set", never as a guessed status.
function WorkerStatusBadge({ value }) {
  const code = normalizeActiveStatus(value);
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${code ? STATUS_STYLE[code] : "bg-gray-100 text-gray-400"}`} title={code ? "Worker status set by a caller" : "No worker status recorded yet"}>
      {code ? ACTIVE_STATUS_LABEL[code] : "Not set"}
    </span>
  );
}

// Per-caller breakdown of their contacts' Worker Status (only non-zero buckets).
function WorkerStatusChips({ counts }) {
  if (!counts) return null;
  const items = ACTIVE_STATUS_OPTIONS.filter((o) => counts[o.value] > 0);
  if (!items.length) return <span className="text-gray-400 hidden lg:inline">No worker status yet</span>;
  return (
    <span className="hidden lg:inline-flex items-center gap-1">
      {items.map((o) => (
        <span key={o.value} className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLE[o.value]}`} title={`${counts[o.value]} ${o.label}`}>
          {counts[o.value]} {o.label}
        </span>
      ))}
    </span>
  );
}
