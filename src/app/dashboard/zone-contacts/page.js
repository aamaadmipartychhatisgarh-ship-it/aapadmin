"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  { key: null, label: "" },
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
  // Self-assign: eligible = unassigned (pool) and not done. Selection spans the current filter/page.
  const [picked, setPicked] = useState(() => new Set());
  const [assigning, setAssigning] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 400); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { setPicked(new Set()); }, [search, lokSabhaId, districtId, assemblyId, designationId, statusF]);
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

  const eligible = (c) => !c.assigned_to_user_id && !c.is_completed;
  const eligibleRows = rows.filter(eligible);
  const pageAllPicked = eligibleRows.length > 0 && eligibleRows.every((c) => picked.has(c.id));
  const togglePick = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function assignToMe() {
    if (assigning || !picked.size) return;
    const dName = designationId ? designations.find((d) => String(d.id) === String(designationId))?.name : null;
    if (!confirm(`Assign ${picked.size} selected contact${picked.size === 1 ? "" : "s"}${dName ? ` (${dName})` : ""} to yourself?`)) return;
    setAssigning(true); setNotice(null);
    try {
      const r = await fetch("/api/zone-contacts/self-assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contact_ids: [...picked] }) });
      const d = await r.json().catch(() => ({}));
      setNotice({ err: !r.ok || !d.assigned, text: d.message || (r.ok ? "Done." : "Could not assign the contacts.") });
      setPicked(new Set());
      await load();
    } catch { setNotice({ err: true, text: "Could not assign the contacts — network error." }); }
    finally { setAssigning(false); }
  }
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
      {notice && <div className={`rounded-lg border text-sm px-4 py-3 ${notice.err ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`} data-testid="zc-notice">{notice.text}</div>}
      {zone?.zone_id && (
        <div className="flex flex-wrap items-center gap-3" data-testid="zc-assign-bar">
          <button type="button" onClick={assignToMe} disabled={!picked.size || assigning} data-testid="zc-assign-me"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-[#164FA3] text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed">
            {assigning ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />} Assign to me{picked.size ? ` (${picked.size})` : ""}
          </button>
          <span className="text-xs text-gray-500">Tick unassigned, pending contacts of your Zone (filter by Designation first if you like) and assign them to yourself.</span>
          {picked.size > 0 && <button type="button" onClick={() => setPicked(new Set())} className="text-xs text-gray-500 hover:underline" data-testid="zc-pick-clear">Clear selection</button>}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]" data-testid="zc-table">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                {COLS.map((c) => c.label === "" ? (
                  <th key="pick" className="px-3 py-3 w-8"><input type="checkbox" checked={pageAllPicked} disabled={!eligibleRows.length} onChange={() => setPicked(pageAllPicked ? new Set() : new Set(eligibleRows.map((x) => x.id)))} aria-label="Select all eligible contacts on this page" data-testid="zc-pick-page" /></th>
                ) : (
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
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {eligible(c) ? <input type="checkbox" checked={picked.has(c.id)} onChange={() => togglePick(c.id)} aria-label={`Select ${c.person_name}`} data-testid="zc-pick-row" /> : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      <Avatar name={c.person_name} src={c.photo_url} size={28} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-[10px]" />
                      <span className="font-medium text-gray-900">{c.person_name}</span>
                      {(c.source === "unfiltered_calls" || c.source_unfiltered_contact_id) && (
                        <span data-testid="from-unfiltered-calls" title="Added from Unfiltered Calls" className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 border border-teal-200 whitespace-nowrap">Unfiltered Calls</span>
                      )}
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
            {totalPages > 1 && <ZoneGoToPage pageCount={totalPages} onPage={setPage} disabled={loading} />}
          </span>
        </div>
      </div>

      {viewing && <PersonDetailModal type="contact" data={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}


// "Go to Page" for the Zone Contacts pager. Self-contained (it shares nothing with the
// Contact Page's pagination): enter a page number, OK jumps there through this page's own
// setPage, so the search, filters, sort and page size in `qs` are untouched. Invalid
// entries (empty, non-numeric, decimal, negative, zero, out of range) show a message and
// never navigate.
function ZoneGoToPage({ pageCount, onPage, disabled }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function check(raw) {
    const v = String(raw ?? "").trim();
    if (!v) return { error: "Enter a page number." };
    if (!/^-?\d+$/.test(v)) return { error: "Enter a whole page number (digits only)." };
    const n = Number(v);
    if (!Number.isSafeInteger(n)) return { error: `Enter a page number between 1 and ${pageCount}.` };
    if (n < 0) return { error: "Page number cannot be negative." };
    if (n === 0) return { error: "Page numbers start at 1." };
    if (n > pageCount) return { error: `Page ${n.toLocaleString()} doesn't exist — there are ${pageCount.toLocaleString()} pages.` };
    return { n };
  }
  function go() {
    const r = check(val);
    if (r.error) { setErr(r.error); return; }
    setErr(""); setOpen(false); setVal("");
    onPage(r.n);
  }

  return (
    <span className="relative" ref={boxRef}>
      <button type="button" onClick={() => { setOpen((o) => !o); setErr(""); setVal(""); }} disabled={disabled} data-testid="zc-goto-btn"
        className="h-8 px-2.5 rounded-md border border-gray-200 text-xs font-medium disabled:opacity-40">Go to Page</button>
      {open && (
        <div className="absolute right-0 bottom-full mb-2 z-30 w-60 rounded-xl border border-gray-200 bg-white shadow-lg p-3 text-left" data-testid="zc-goto-box" role="dialog" aria-label="Go to page">
          <label className="block text-xs font-medium text-gray-500 mb-1">Page number (1–{pageCount.toLocaleString()})</label>
          <input autoFocus value={val} inputMode="numeric" data-testid="zc-goto-input" placeholder={`e.g. ${Math.min(pageCount, 25)}`}
            onChange={(e) => { setVal(e.target.value); if (err) setErr(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } else if (e.key === "Escape") setOpen(false); }}
            className={`w-full h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]/30 ${err ? "border-red-300" : "border-gray-200"}`} />
          {err && <p className="text-xs text-red-600 mt-1" data-testid="zc-goto-error">{err}</p>}
          <div className="flex justify-end gap-2 mt-2.5">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="button" onClick={go} data-testid="zc-goto-ok" className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#164FA3] text-white hover:bg-blue-800">OK</button>
          </div>
        </div>
      )}
    </span>
  );
}
