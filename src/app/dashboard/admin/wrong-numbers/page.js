"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { isOversight, isAdmin, isCaller } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";
import { AlertCircle, Search, Loader2, RotateCcw, Pencil, Trash2, History, UserCog, Download, FileText, X, GitMerge, Send, HeartCrack, PhoneOff } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ActionBar from "@/components/ActionBar";
import CollapsibleSection from "@/components/CollapsibleSection";
import Avatar from "@/components/Avatar";
import { WRONG_NUMBER_REASONS } from "@/components/CallActionIcons";
import { unfilteredWrongReasonLabel } from "@/lib/unfilteredWrongReasons";

const CAT_LABEL = { wrong_number: "Wrong Number", not_interested: "Not Interested", switched_off: "10+ Switched Off", incoming_off: "10+ Incoming Off" };
const REASON_LABEL = Object.fromEntries(WRONG_NUMBER_REASONS.map((r) => [r.value, r.label]));

export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  // Oversight OR caller by role, OR a Page-Access grant for this page (managed
  // override). Wrong Numbers is also a FIXED caller page, so a managed caller
  // always keeps it (Not Interested / Wrong Number workflow never breaks).
  const { ready, allowed } = usePageGuard("wrong_numbers", isOversight(session) || isCaller(session));
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);
  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <WrongNumbersDashboard session={session} oversight={isOversight(session)} canDelete={isAdmin(session)} />;
}

// Status Management - the ONE consolidated page for the former Wrong Number, Not Interested, 10+ Times Switched Off and
// 10+ Times Incoming Off pages: a single Status dropdown (every calling status + Not Interested) and a single Source dropdown
// (Contact Page / Worker & Voter Registration Page / Unfiltered Calls) over one server-side list (/api/admin/status-management).
// Exported so the Contacts page can render the SAME dashboard as its Status Management tab - one component, one data source.
export function WrongNumbersDashboard({ session, oversight, canDelete }) {
  return <Body canDelete={canDelete} readOnly={!oversight} embedded />;
}

const fmt = (d) => d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function Body({ canDelete, readOnly = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [lokSabhaId, setLokSabhaId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  const [caller, setCaller] = useState("");
  const [assignF, setAssignF] = useState("");   // assigned | unassigned
  const [reasonF, setReasonF] = useState("");
  // The ONE Status filter (any calling status, or Not Interested) and the ONE Source filter. Legacy links
  // (?tab=wrong | not_interested, ?type=switched | incoming, ?status=...) open the page with that Status selected.
  const [statusF, setStatusF] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const st = q.get("status"); if (st) return st;
      const tp = q.get("tab"), ty = q.get("type");
      if (tp === "wrong") return "Wrong Number";
      if (tp === "not_interested") return "Not Interested";
      if (tp === "switched" || ty === "switched") return "Switched Off";
      if (tp === "incoming" || ty === "incoming") return "Incoming Off";
    } catch {}
    return "";
  });
  const [sourceF, setSourceF] = useState(() => { try { return new URLSearchParams(window.location.search).get("source") || ""; } catch { return ""; } });
  const [statusOpts, setStatusOpts] = useState([]);
  const [sourceOpts, setSourceOpts] = useState([]);
  const [pg, setPg] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, total_pages: 1, counts: null });
  const PAGE_SIZE = 50;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [callers, setCallers] = useState([]);
  const [reassign, setReassign] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [historyRow, setHistoryRow] = useState(null);
  const [mergeRow, setMergeRow] = useState(null);
  const [verifyBusyId, setVerifyBusyId] = useState(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
    fetch("/api/locations?type=lok_sabha").then((r) => r.json()).then((d) => setLokSabhas(d.locations || []));
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
    fetch("/api/locations?type=assembly").then((r) => r.json()).then((d) => setAssemblies(d.locations || []));
    fetch("/api/users").then((r) => r.ok ? r.json() : { users: [] }).then((d) => setCallers((d.users || []).filter((u) => ["caller", "user", "agent"].includes(u.role)))).catch(() => {});
  }, []);

  const qs = () => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (zoneId) p.set("zone_id", zoneId);
    if (lokSabhaId) p.set("lok_sabha_id", lokSabhaId);
    if (districtId) p.set("district_id", districtId);
    if (assemblyId) p.set("assembly_id", assemblyId);
    if (caller) p.set("caller", caller);
    if (statusF) p.set("status", statusF);
    if (assignF) p.set("assignment", assignF);
    if (reasonF) p.set("reason", reasonF);
    if (sourceF) p.set("source", sourceF);
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    return p;
  };

  async function load() {
    setLoading(true);
    const p = qs(); p.set("page", String(pg)); p.set("page_size", String(PAGE_SIZE));
    const r = await fetch(`/api/admin/status-management?${p}`, { cache: "no-store" });
    if (r.ok) {
      const d = await r.json();
      setRows(d.rows || []); setPageInfo({ total: d.total || 0, total_pages: d.total_pages || 1, counts: d.counts || null });
      if (d.status_options) setStatusOpts(d.status_options);
      if (d.source_options) setSourceOpts(d.source_options);
      if (d.page && d.page !== pg) setPg(d.page);
    } else { setRows([]); setPageInfo({ total: 0, total_pages: 1, counts: null }); }
    setLoading(false);
  }
  // any filter change returns to page 1
  useEffect(() => { setPg(1); }, [search, zoneId, lokSabhaId, districtId, assemblyId, caller, statusF, assignF, reasonF, sourceF, from, to]);
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, zoneId, lokSabhaId, districtId, assemblyId, caller, statusF, assignF, reasonF, sourceF, from, to, pg]);

  // Restore Not-in-Service contacts to the Contact List (the same contact rows - nothing is inserted). Eligible rows carry a checkbox;
  // the dialog is built from a server-side dry run so it states exactly what will be restored.
  const [nisSel, setNisSel] = useState(() => new Set());
  const [nisDlg, setNisDlg] = useState(null);
  const [nisBusy, setNisBusy] = useState(false);
  const nisRows = rows.filter((c) => c.not_in_service && c.row_type !== "unfiltered");
  const toggleNis = (id) => setNisSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function openNis() {
    setMsg(""); setNisDlg({ loading: true, preview: null });
    try {
      const r = await fetch("/api/admin/wrong-numbers/restore-not-in-service", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...nisSel], dry_run: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setNisDlg(null); setMsg(d.message || "Could not check the selection."); return; }
      setNisDlg({ loading: false, preview: d });
    } catch { setNisDlg(null); setMsg("Could not check the selection - network error."); }
  }
  async function confirmNis() {
    if (nisBusy || !nisDlg?.preview?.eligible) return;
    setNisBusy(true);
    try {
      const r = await fetch("/api/admin/wrong-numbers/restore-not-in-service", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: nisDlg.preview.eligible_ids }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(`${d.message || "Could not restore the selected contacts."} Nothing was changed.`);
      else { setMsg(d.message); setNisSel(new Set()); load(); }
    } catch { setMsg("Could not restore the selected contacts - network error. Nothing was reported as restored."); }
    finally { setNisBusy(false); setNisDlg(null); }
  }

  async function restore(id) {
    if (!confirm("Restore this contact to the active calling queue?")) return;
    const r = await fetch(`/api/admin/wrong-numbers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) });
    if (r.ok) { setMsg("Contact restored to the calling queue."); load(); }
  }
  // Restore from Not Interested / a 10+ list: the same endpoints the old pages used (a true move of the SAME contact row).
  async function restoreCategory(c, cat) {
    const label = cat === "not_interested" ? "Not Interested" : cat === "switched_off" ? "10+ Times Switched Off" : "10+ Times Incoming Off";
    if (!confirm(`Restore ${c.person_name || "this contact"} from ${label}? Its call history stays intact.`)) return;
    const url = cat === "not_interested" ? `/api/not-interested/${c.id}` : `/api/contacts/repeat-off/${c.id}`;
    const body = cat === "not_interested" ? { action: "restore" } : { type: cat === "incoming_off" ? "incoming" : "switched" };
    const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { setMsg(`Contact restored from ${label}.`); load(); }
    else { const d = await r.json().catch(() => ({})); setMsg(d.message || "Could not restore this contact."); }
  }
  async function del(id) {
    if (!confirm("Permanently delete this record? This cannot be undone.")) return;
    const r = await fetch(`/api/admin/wrong-numbers/${id}`, { method: "DELETE" });
    if (r.ok) { setMsg("Record deleted."); load(); }
    else { const d = await r.json().catch(() => ({})); setMsg(d.message || "Delete failed."); }
  }
  // Send for Verification — routes this record into the designation-based
  // correction workflow (Report → Supervisor verifies → Designation fixes it),
  // reusing the same endpoint the caller-facing "Report number issue" uses.
  async function sendForVerification(c) {
    setVerifyBusyId(c.id);
    const r = await fetch(`/api/contacts/${c.id}/report-issue`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "wrong_number", note: "Sent for verification from the Wrong Numbers module." }),
    });
    setVerifyBusyId(null);
    if (r.ok) setMsg(`Sent for verification. Open Number Corrections to route it to a designation.`);
    else { const d = await r.json().catch(() => ({})); setMsg(d.message || "Failed to send for verification."); }
  }

  const sel = "h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white";
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={AlertCircle}
        title="Status Management"
        description={`${pageInfo.total.toLocaleString()} record${pageInfo.total === 1 ? "" : "s"} — Wrong Number, Not Interested, 10+ Times Switched Off and 10+ Times Incoming Off in one place. Filter by Status and Source.`}
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "People" }, { label: "Status Management" }]}
        actions={readOnly ? null : <ActionBar items={[
          { key: "xlsx", label: "Wrong Numbers Excel", icon: Download, href: `/api/admin/wrong-numbers/export/xlsx?${qs()}` },
          { key: "pdf", label: "Wrong Numbers PDF", icon: FileText, href: `/api/admin/wrong-numbers/export/pdf?${qs()}` },
        ]} />}
      />

      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 text-sm">{msg}</div>}
      {!readOnly && nisRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3" data-testid="nis-bar">
          <button type="button" onClick={openNis} disabled={!nisSel.size || nisBusy} data-testid="nis-restore"
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <RotateCcw size={15} /> Restore to Contact List{nisSel.size ? ` (${nisSel.size})` : ""}
          </button>
          <span className="text-xs text-gray-500">{nisRows.length} Not in Service contact{nisRows.length === 1 ? "" : "s"} can be restored — tick them below.</span>
          {nisSel.size > 0 && <button type="button" onClick={() => setNisSel(new Set())} className="text-xs text-gray-500 hover:underline">Clear selection</button>}
        </div>
      )}
      {nisDlg && (
        <div className="fixed inset-0 z-[150] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid="nis-confirm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
            <h3 className="text-base font-bold text-gray-900">Restore to Contact List</h3>
            {nisDlg.loading ? <div className="py-6 text-center"><Loader2 className="animate-spin inline text-gray-400" size={18} /></div> : (
              <>
                <p className="text-sm text-gray-700 mt-2" data-testid="nis-eligible"><span className="font-semibold">{nisDlg.preview.eligible}</span> of {nisDlg.preview.selected} selected contact{nisDlg.preview.selected === 1 ? " is" : "s are"} Not in Service and will be restored.</p>
                {nisDlg.preview.selected - nisDlg.preview.eligible > 0 && (
                  <p className="text-xs text-gray-500 mt-2">{nisDlg.preview.counts.already_restored} already restored, {nisDlg.preview.counts.not_eligible} not Not in Service{nisDlg.preview.counts.not_found ? `, ${nisDlg.preview.counts.not_found} not found` : ""} — these will be skipped.</p>
                )}
                <p className="text-xs text-gray-500 mt-2">The same contact is restored (no new record). Its details, source, assignment and call history are kept.</p>
              </>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setNisDlg(null)} disabled={nisBusy} data-testid="nis-cancel" className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={confirmNis} disabled={nisBusy || nisDlg.loading || !nisDlg.preview?.eligible} data-testid="nis-confirm-yes" className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">{nisBusy ? "Restoring…" : `Confirm${nisDlg.preview?.eligible ? ` (${nisDlg.preview.eligible})` : ""}`}</button>
            </div>
          </div>
        </div>
      )}

      <CollapsibleSection title="Search & Filters">
      <div className="flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or mobile" className="flex-1 min-w-[160px] outline-none text-sm py-2" />
        <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={sel}><option value="">All zones</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
        <select value={lokSabhaId} onChange={(e) => setLokSabhaId(e.target.value)} className={sel}><option value="">All Lok Sabhas</option>{lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className={sel}><option value="">All districts</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)} className={sel}><option value="">All assemblies</option>{assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select value={caller} onChange={(e) => setCaller(e.target.value)} className={sel}><option value="">All callers</option>{callers.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}</select>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={sel} aria-label="Status" data-testid="sm-status-filter"><option value="">All statuses</option>{statusOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}{statusF && !statusOpts.some((o) => o.value === statusF) && <option value={statusF}>{statusF}</option>}</select>
        <select value={sourceF} onChange={(e) => setSourceF(e.target.value)} className={sel} aria-label="Source" data-testid="sm-source-filter"><option value="">All sources</option>{(sourceOpts.length ? sourceOpts : [{ value: "contact_page", label: "Contact Page" }, { value: "registration", label: "Worker & Voter Registration Page" }, { value: "unfiltered_calls", label: "Unfiltered Calls" }]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select value={assignF} onChange={(e) => setAssignF(e.target.value)} className={sel} aria-label="Assignment" data-testid="sm-assign-filter"><option value="">Any assignment</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option></select>
        <select value={reasonF} onChange={(e) => setReasonF(e.target.value)} className={sel}><option value="">Any reason</option>{WRONG_NUMBER_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Marked from" className={sel} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Marked to" className={sel} />
      </div>
      </CollapsibleSection>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400"><AlertCircle size={36} className="mx-auto text-gray-300 mb-3" />No records match the selected Status and Source.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-left">
                <tr>
                  {["", "Name", "Mobile", "Source", "Designation", "Zone", "Lok Sabha", "District", "Assembly", "Block/Ward", "Address", "Caller", "Marked By", "Marked Wrong", "Reason", "Notes", "Wrong # Attempts", "Status", "Actions"].map((h) => (
                    <th key={h} className="px-3 py-3 font-semibold text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-red-50/20 align-top">
                    <td className="px-3 py-3">{!readOnly && c.not_in_service && c.row_type !== "unfiltered" ? <input type="checkbox" checked={nisSel.has(c.id)} onChange={() => toggleNis(c.id)} aria-label={`Select ${c.person_name}`} data-testid="nis-pick" /> : null}</td>
                    <td className="px-3 py-3 font-medium text-gray-900">
                      <div className="flex items-center gap-2">
                        <Avatar name={c.person_name} src={c.photo_url} size={28} className="bg-red-50 border border-red-100" textClassName="text-red-600 text-[10px]" />
                        {c.person_name}
                        {c.row_type === "unfiltered" && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200" data-testid="wn-source-unfiltered">Unfiltered Call</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-700">{c.phone_number}</td>
                    <td className="px-3 py-3 text-xs" data-testid="wn-source"><span className="font-semibold text-gray-700">{c.source_label || "—"}</span></td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.designation_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.zone_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.lok_sabha_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.district_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.assembly_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.ward_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600 max-w-[160px] truncate" title={c.address || ""}>{c.address || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-700">{c.caller_name || <span className="text-gray-300">Unassigned</span>}</td>
                    <td className="px-3 py-3 text-xs text-gray-700">{c.marked_by_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{fmt(c.marked_wrong_date)}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.wrong_number_reason ? (c.row_type === "unfiltered" ? (unfilteredWrongReasonLabel(c.wrong_number_reason) || c.wrong_number_reason) : (REASON_LABEL[c.wrong_number_reason] || c.wrong_number_reason)) : "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600 max-w-[160px] truncate" title={c.wrong_number_notes || c.last_remarks || ""}>{c.wrong_number_notes || c.last_remarks || "—"}</td>
                    <td className="px-3 py-3 text-center font-bold text-gray-700">{c.wrong_attempts}</td>
                    <td className="px-3 py-3" data-testid="sm-status-cell">
                      <div className="flex flex-wrap gap-1">
                        {(c.categories || []).map((k) => <span key={k} data-testid={`sm-cat-${k}`} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">{CAT_LABEL[k]}</span>)}
                        {c.not_in_service && c.row_type !== "unfiltered" ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">Not in Service</span> : null}
                      </div>
                      {c.latest_status && <div className="text-[10px] text-gray-400 mt-0.5" data-testid="sm-latest-status">Latest: {c.latest_status}</div>}
                    </td>
                    <td className="px-3 py-3">
                      {c.row_type === "unfiltered" ? <span className="text-[11px] text-gray-400">Unfiltered record</span> : readOnly ? <span className="text-[11px] text-gray-400">View only</span> : (
                      <div className="flex items-center gap-1">
                        {(c.categories || []).includes("wrong_number") && <IconBtn title="Restore from Wrong Number to queue" onClick={() => restore(c.id)} className="text-emerald-600 hover:bg-emerald-50"><RotateCcw size={15} /></IconBtn>}
                        {(c.categories || []).filter((k) => k !== "wrong_number").map((k) => <IconBtn key={k} title={`Restore from ${CAT_LABEL[k]}`} onClick={() => restoreCategory(c, k)} className="text-emerald-600 hover:bg-emerald-50"><RotateCcw size={15} /></IconBtn>)}
                        <IconBtn title="Edit contact / mobile number" onClick={() => setEditRow(c)} className="text-[#164FA3] hover:bg-blue-50"><Pencil size={15} /></IconBtn>
                        <IconBtn title="Reassign caller" onClick={() => setReassign(c)} className="text-amber-600 hover:bg-amber-50"><UserCog size={15} /></IconBtn>
                        <IconBtn title="Merge into another contact" onClick={() => setMergeRow(c)} className="text-violet-600 hover:bg-violet-50"><GitMerge size={15} /></IconBtn>
                        <IconBtn title="Send for verification" onClick={() => sendForVerification(c)} className="text-sky-600 hover:bg-sky-50" disabled={verifyBusyId === c.id}>
                          {verifyBusyId === c.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                        </IconBtn>
                        <IconBtn title="Call history" onClick={() => setHistoryRow(c)} className="text-gray-600 hover:bg-gray-100"><History size={15} /></IconBtn>
                        {canDelete && <IconBtn title="Delete permanently" onClick={() => del(c.id)} className="text-red-600 hover:bg-red-50"><Trash2 size={15} /></IconBtn>}
                      </div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pageInfo.total_pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600" data-testid="sm-pagination">
          <span>Page {pg} of {pageInfo.total_pages} · {pageInfo.total.toLocaleString()} records</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPg((x) => Math.max(1, x - 1))} disabled={pg <= 1} data-testid="sm-prev" className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-40">Previous</button>
            <button type="button" onClick={() => setPg((x) => Math.min(pageInfo.total_pages, x + 1))} disabled={pg >= pageInfo.total_pages} data-testid="sm-next" className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      {reassign && <ReassignModal row={reassign} callers={callers} onClose={() => setReassign(null)} onSaved={() => { setReassign(null); setMsg("Contact reassigned."); load(); }} />}
      {editRow && <EditModal row={editRow} onClose={() => setEditRow(null)} onSaved={() => { setEditRow(null); setMsg("Contact updated."); load(); }} />}
      {historyRow && <HistoryModal row={historyRow} onClose={() => setHistoryRow(null)} />}
      {mergeRow && (
        <MergeModal
          row={mergeRow}
          onClose={() => setMergeRow(null)}
          onSaved={(d) => { setMergeRow(null); setMsg(d.message || "Merged."); load(); }}
        />
      )}
    </div>
  );
}

function IconBtn({ title, onClick, className, disabled, children }) {
  return <button title={title} onClick={onClick} disabled={disabled} className={`p-1.5 rounded-lg disabled:opacity-40 ${className}`}>{children}</button>;
}

const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-gray-900">{title}</h2><button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button></div>
        {children}
      </div>
    </div>
  );
}

function ReassignModal({ row, callers, onClose, onSaved }) {
  const [userId, setUserId] = useState(row.assigned_to_user_id || "");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!userId) return;
    setSaving(true);
    const r = await fetch(`/api/admin/wrong-numbers/${row.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reassign", user_id: userId }) });
    if (r.ok) onSaved(); else setSaving(false);
  }
  return (
    <Modal title={`Reassign ${row.person_name}`} onClose={onClose}>
      <p className="text-sm text-gray-500">Choose the caller to assign this contact to. (Reassigning does not restore it to the queue — use Restore for that.)</p>
      <select className={inp} value={userId} onChange={(e) => setUserId(e.target.value)}>
        <option value="">Select caller…</option>
        {callers.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
      </select>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
        <button onClick={save} disabled={saving || !userId} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : "Reassign"}</button>
      </div>
    </Modal>
  );
}

function EditModal({ row, onClose, onSaved }) {
  const [form, setForm] = useState({ person_name: row.person_name || "", phone_number: row.phone_number || "", address: row.address || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true); setError("");
    const r = await fetch(`/api/contacts/${row.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) onSaved(); else { const d = await r.json().catch(() => ({})); setError(d.message || "Failed to save."); setSaving(false); }
  }
  return (
    <Modal title="Edit Contact" onClose={onClose}>
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
      <input className={inp} placeholder="Name" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} />
      <input className={`${inp} font-mono`} placeholder="Mobile" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
      <input className={inp} placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
        <button onClick={save} disabled={saving || !form.person_name || !form.phone_number} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

// Merge this (wrong-number) contact into an existing correct one — search by
// name/phone, pick the target, confirm. Call/task history moves to the
// target; this duplicate row is removed once nothing points at it anymore.
function MergeModal({ row, onClose, onSaved }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/contacts?search=${encodeURIComponent(q)}&status=all&page_size=8`)
        .then((r) => r.json())
        .then((d) => setResults((d.contacts || []).filter((c) => c.id !== row.id)))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, row.id]);

  async function save() {
    if (!target) return;
    setSaving(true); setError("");
    const r = await fetch(`/api/admin/wrong-numbers/${row.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "merge", target_contact_id: target.id }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) onSaved(d);
    else { setError(d.message || "Merge failed."); setSaving(false); }
  }

  return (
    <Modal title={`Merge "${row.person_name}" into…`} onClose={onClose}>
      <p className="text-sm text-gray-500">
        Search for the correct contact record. All call/task history from <strong>{row.person_name}</strong> ({row.phone_number}) moves to the
        contact you pick, then this duplicate is removed.
      </p>
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
      {!target ? (
        <>
          <input className={inp} placeholder="Search name or mobile…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {searching && <div className="text-xs text-gray-400 py-2"><Loader2 size={13} className="inline animate-spin" /> Searching…</div>}
          {!searching && q.trim() && results.length === 0 && <div className="text-xs text-gray-400 py-2">No matching contacts.</div>}
          <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
            {results.map((c) => (
              <button key={c.id} onClick={() => setTarget(c)} className="w-full text-left px-2 py-2 hover:bg-gray-50 text-sm flex items-center justify-between">
                <span className="font-medium text-gray-900">{c.person_name}</span>
                <span className="text-xs text-gray-500 font-mono">{c.phone_number}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="bg-violet-50 border border-violet-100 rounded-lg p-3 flex items-center justify-between">
          <div>
            <div className="font-semibold text-gray-900">{target.person_name}</div>
            <div className="text-xs text-gray-500 font-mono">{target.phone_number}</div>
          </div>
          <button onClick={() => setTarget(null)} className="text-xs text-gray-500 hover:text-gray-700">Change</button>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
        <button onClick={save} disabled={saving || !target} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg font-semibold flex items-center gap-1.5">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />}
          {saving ? "Merging…" : "Merge"}
        </button>
      </div>
    </Modal>
  );
}

function HistoryModal({ row, onClose }) {
  const [history, setHistory] = useState(null);
  useEffect(() => {
    fetch(`/api/contacts/${row.id}/history`).then((r) => r.json()).then((d) => setHistory(d.history || [])).catch(() => setHistory([]));
  }, [row.id]);
  return (
    <Modal title={`Call history — ${row.person_name}`} onClose={onClose}>
      {history === null ? <div className="text-gray-400 text-sm"><Loader2 className="inline animate-spin" /></div>
        : history.length === 0 ? <div className="text-gray-400 text-sm">No calls logged.</div>
        : (
          <ul className="divide-y divide-gray-100">
            {history.map((h) => (
              <li key={h.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{new Date(h.called_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-xs text-gray-500">{h.agent_name} · {h.status_name}</span>
                </div>
                {h.remarks && <div className="text-gray-600 italic">"{h.remarks}"</div>}
                {h.sentiment && <div className="text-xs text-gray-400 mt-0.5">{h.sentiment}</div>}
              </li>
            ))}
          </ul>
        )}
    </Modal>
  );
}
