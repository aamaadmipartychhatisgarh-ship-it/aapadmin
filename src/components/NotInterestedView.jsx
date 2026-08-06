"use client";

import { useEffect, useState } from "react";
import { Search, Loader2, HeartCrack } from "lucide-react";
import Avatar from "@/components/Avatar";
import CollapsibleSection from "@/components/CollapsibleSection";
import { isCaller } from "@/lib/permissions";

const PAGE_SIZE = 50;
const fmt = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

// The reason(s) a contact qualifies, built from the flags the API returns.
function reasonText(r) {
  const parts = [];
  if (Number(r.switched_off_count) > 5) parts.push(`Switched Off (${r.switched_off_count} Times)`);
  if (Number(r.has_negative)) parts.push("Negative Sentiment");
  if (Number(r.has_opponent)) parts.push("Opponent");
  if (Number(r.has_not_supporter)) parts.push("Not a Supporter");
  if (Number(r.has_rude)) parts.push("Rudely Behaved");
  return parts.join(", ") || "—";
}
function statusLabel(c) {
  if (c.is_completed) return "Done";
  return c.assigned_to_user_id ? "Assigned" : "Pool";
}

// The "Not Interested" tab body — same filters / table / pagination shape as the
// rest of the Contacts area, backed by /api/not-interested (which role-scopes
// the data). `onCount` bubbles the total up so the tab header can show it.
export default function NotInterestedView({ session, onCount }) {
  const canSeeCallers = !isCaller(session);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [lokSabhaId, setLokSabhaId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [caller, setCaller] = useState("");
  const [statusF, setStatusF] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [callers, setCallers] = useState([]);

  useEffect(() => {
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || [])).catch(() => {});
    fetch("/api/locations?type=lok_sabha").then((r) => r.json()).then((d) => setLokSabhas(d.locations || [])).catch(() => {});
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || [])).catch(() => {});
    fetch("/api/locations?type=assembly").then((r) => r.json()).then((d) => setAssemblies(d.locations || [])).catch(() => {});
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || [])).catch(() => {});
    if (canSeeCallers) {
      fetch("/api/users").then((r) => (r.ok ? r.json() : { users: [] }))
        .then((d) => setCallers((d.users || []).filter((u) => ["caller", "user", "agent"].includes(u.role)))).catch(() => {});
    }
  }, [canSeeCallers]);

  const qs = (pageNum) => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (zoneId) p.set("zone_id", zoneId);
    if (lokSabhaId) p.set("lok_sabha_id", lokSabhaId);
    if (districtId) p.set("district_id", districtId);
    if (assemblyId) p.set("assembly_id", assemblyId);
    if (designationId) p.set("designation_id", designationId);
    if (caller) p.set("caller", caller);
    if (statusF) p.set("status", statusF);
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    p.set("page", String(pageNum));
    p.set("page_size", String(PAGE_SIZE));
    return p;
  };

  async function load(pageNum) {
    setLoading(true);
    const r = await fetch(`/api/not-interested?${qs(pageNum)}`, { cache: "no-store" });
    if (r.ok) {
      const d = await r.json();
      setRows(d.rows || []);
      setTotal(d.total || 0);
      onCount?.(d.total || 0);
    }
    setLoading(false);
  }

  // Reload when filters change (debounced for typing); reset to page 1.
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(1); }, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, zoneId, lokSabhaId, districtId, assemblyId, designationId, caller, statusF, from, to]);
  useEffect(() => { load(page); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sel = "h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white";
  const HEADERS = ["Name", "Phone", "Designation", "Zone", "Lok Sabha", "Assembly", "District", "Address", "Status", "Assigned Caller", "Last Call Date", "Total Calls", "Reason"];

  return (
    <div className="space-y-4">
      <CollapsibleSection title="Search & Filters">
        <div className="flex items-center gap-3 flex-wrap">
          <Search size={18} className="text-gray-400 ml-2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or mobile" className="flex-1 min-w-[160px] outline-none text-sm py-2" />
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={sel}><option value="">All zones</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
          <select value={lokSabhaId} onChange={(e) => setLokSabhaId(e.target.value)} className={sel}><option value="">All Lok Sabhas</option>{lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className={sel}><option value="">All districts</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)} className={sel}><option value="">All assemblies</option>{assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select value={designationId} onChange={(e) => setDesignationId(e.target.value)} className={sel}><option value="">All designations</option>{designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          {canSeeCallers && (
            <select value={caller} onChange={(e) => setCaller(e.target.value)} className={sel}><option value="">All callers</option>{callers.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}</select>
          )}
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={sel}><option value="">Any status</option><option value="assigned">Assigned</option><option value="unassigned">Pool (unassigned)</option><option value="done">Done</option><option value="pending">Pending</option></select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Last call from" className={sel} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Last call to" className={sel} />
        </div>
      </CollapsibleSection>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400"><HeartCrack size={36} className="mx-auto text-gray-300 mb-3" />No “Not Interested” contacts match.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-left">
                <tr>{HEADERS.map((h) => <th key={h} className="px-3 py-3 font-semibold text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-rose-50/30 align-top">
                    <td className="px-3 py-3 font-medium text-gray-900">
                      <div className="flex items-center gap-2">
                        <Avatar name={c.person_name} src={c.photo_url} size={28} className="bg-rose-50 border border-rose-100" textClassName="text-rose-600 text-[10px]" />
                        {c.person_name}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-700">{c.phone_number}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.designation_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.zone_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.lok_sabha_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.assembly_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.district_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600 max-w-[160px] truncate" title={c.address || ""}>{c.address || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-700">{statusLabel(c)}</td>
                    <td className="px-3 py-3 text-xs text-gray-700">{c.assigned_caller_name || <span className="text-gray-300">Pool</span>}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{fmt(c.last_call_date)}</td>
                    <td className="px-3 py-3 text-center font-bold text-gray-700">{c.total_calls}</td>
                    <td className="px-3 py-3 text-xs">
                      <span className="inline-block text-[11px] font-semibold px-2 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-100">{reasonText(c)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Prev</button>
            <span className="tabular-nums">Page {page} / {totalPages}</span>
            <button disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
