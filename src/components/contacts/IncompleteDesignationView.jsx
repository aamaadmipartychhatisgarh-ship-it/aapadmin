"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Network, MapPin, FileText, Download, CheckCircle2, Circle } from "lucide-react";
import Avatar from "@/components/Avatar";

// CONTACTS → INCOMPLETE DESIGNATION — Level & Designation-wise assignment.
//
// Designation Master (designations.level) is the single source of truth: pick a
// LEVEL and the page shows only the designations mapped to that exact level, one
// row per (location × designation), with the person assigned to that EXACT
// location + designation, or "Not Assigned". Filled / Blank filters + live
// Total/Filled/Blank counts, and PDF/Excel export of exactly what's displayed.
// Everything is fetched live — nothing hardcoded.
const LEVELS = [
  { key: "state", label: "State" },
  { key: "zone", label: "Zone" },
  { key: "lok_sabha", label: "Lok Sabha" },
  { key: "district", label: "District" },
  { key: "assembly", label: "Assembly" },
  { key: "block", label: "Block" },
];

const inp = "h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 outline-none focus:border-[#164FA3] focus:ring-1 focus:ring-[#164FA3]";

const PERSONS_PAGE_SIZE = 50;

export default function IncompleteDesignationView() {
  const [level, setLevel] = useState("state");
  const [designationId, setDesignationId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [status, setStatus] = useState("all"); // all | filled | blank
  // "matrix" = the location × designation table; "persons" = the flattened Total
  // Assigned Person list (opened by clicking that card), server-side paginated.
  const [view, setView] = useState("matrix");
  const [ppage, setPpage] = useState(1);
  const [data, setData] = useState({ rows: [], level_designations: [], all_locations: [], counts: { total: 0, filled: 0, blank: 0, assigned_persons: 0, assigned_unique: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Build the querystring ONCE so the table fetch and the PDF/Excel export use
  // the identical filters — the export can never drift from the on-screen data.
  const qs = useCallback(() => {
    const p = new URLSearchParams({ level });
    if (designationId) p.set("designation_id", designationId);
    if (locationId) p.set("location_id", locationId);
    if (status !== "all") p.set("status", status);
    return p.toString();
  }, [level, designationId, locationId, status]);

  // The list query adds the persons view + pagination on top of the shared filters.
  const listQs = useCallback(() => {
    const p = new URLSearchParams(qs());
    if (view === "persons") {
      p.set("view", "persons");
      p.set("page", String(ppage));
      p.set("page_size", String(PERSONS_PAGE_SIZE));
    }
    return p.toString();
  }, [qs, view, ppage]);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/contacts/incomplete?${listQs()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load."))))
      .then((d) => { setData(d); setError(""); })
      .catch((e) => setError(e.message || "Failed to load."))
      .finally(() => setLoading(false));
  }, [listQs]);

  useEffect(() => { load(); }, [load]);
  // Changing the level clears the level-specific designation & location filters.
  useEffect(() => { setDesignationId(""); setLocationId(""); }, [level]);
  // Any filter change resets the persons page so the count and the list stay in
  // step (page 1 of the freshly-filtered set).
  useEffect(() => { setPpage(1); }, [level, designationId, locationId, view]);

  const rows = data.rows || [];
  const persons = data.persons || [];
  const personsPagination = data.pagination || { page: 1, pageSize: PERSONS_PAGE_SIZE, total: 0, totalPages: 1 };
  const levelDesignations = data.level_designations || [];
  const allLocations = data.all_locations || [];
  const counts = data.counts || { total: 0, filled: 0, blank: 0, assigned_persons: 0, assigned_unique: 0 };
  const levelLabel = LEVELS.find((l) => l.key === level)?.label || level;
  const isState = level === "state";
  const personsView = view === "persons";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center"><Network size={18} /></div>
        <div className="mr-auto">
          <h2 className="text-lg font-bold text-gray-900">Incomplete Designation</h2>
          <p className="text-sm text-gray-500">Level &amp; designation-wise assignment — mapped live from Designation Master.</p>
        </div>
        {/* Export the CURRENT filtered view (level + designation + location + filled/blank). */}
        <a href={`/api/contacts/incomplete/export/xlsx?${qs()}`}
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50">
          <Download size={15} /> Excel
        </a>
        <a href={`/api/contacts/incomplete/export/pdf?${qs()}`}
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50">
          <FileText size={15} /> PDF
        </a>
      </div>

      {/* Counts. "Total Assigned Person" is clickable — it opens the flattened,
          paginated list of every assigned person behind the count. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CountCard label="Total Designations" value={counts.total} tone="blue" active={!personsView} onClick={() => setView("matrix")} />
        <CountCard label="Filled" value={counts.filled} tone="green" active={!personsView && status === "filled"} onClick={() => { setView("matrix"); setStatus("filled"); }} />
        <CountCard label="Blank" value={counts.blank} tone="amber" active={!personsView && status === "blank"} onClick={() => { setView("matrix"); setStatus("blank"); }} />
        <CountCard
          label="Total Assigned Person"
          value={counts.assigned_persons}
          hint={counts.assigned_unique != null ? `${Number(counts.assigned_unique).toLocaleString()} unique` : null}
          tone="violet"
          active={personsView}
          onClick={() => setView("persons")}
        />
      </div>

      {/* Controls: Level + Designation + Location + Filled/Blank */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Level</label>
          <select className={inp} value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Designation ({levelLabel})</label>
          <select className={inp} value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
            <option value="">All {levelLabel} designations</option>
            {levelDesignations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        {!isState && (
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{levelLabel}</label>
            <select className={inp} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All {levelLabel.toLowerCase()}s</option>
              {allLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
        {personsView ? (
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">View</label>
            <button onClick={() => setView("matrix")}
              className="h-10 px-3.5 text-sm font-semibold rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
              ← Back to designation matrix
            </button>
          </div>
        ) : (
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Status</label>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
              {[["all", "All"], ["filled", "Filled"], ["blank", "Blank"]].map(([k, lbl]) => (
                <button key={k} onClick={() => setStatus(k)}
                  className={`h-10 px-3.5 text-sm font-semibold transition-colors ${status === k ? "bg-[#164FA3] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="ml-auto text-sm text-gray-500 self-center">
          {loading ? <span className="inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Loading…</span>
            : personsView ? <span><strong className="text-gray-900">{Number(personsPagination.total).toLocaleString()}</strong> assigned persons</span>
            : <span><strong className="text-gray-900">{rows.length.toLocaleString()}</strong> {status === "all" ? "records" : status}</span>}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2.5 text-sm">{error}</div>}

      {/* PERSONS VIEW — the Total Assigned Person drill-down, server-side
          paginated. The count on the card equals personsPagination.total. */}
      {personsView ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">Assigned Person</th>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">Designation</th>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">{isState ? "Level" : levelLabel}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading && persons.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-10 text-center text-gray-400"><Loader2 className="animate-spin inline text-[#164FA3]" /></td></tr>
                ) : persons.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-10 text-center text-gray-400">No assigned persons match the current filters.</td></tr>
                ) : persons.map((p, i) => (
                  <tr key={`${p.contact_id}:${p.designation_id}:${p.location_id}:${i}`} className="hover:bg-gray-50/60">
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={p.person_name} src={p.photo_url} size={28} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-[10px]" />
                        <span className="text-gray-900 font-medium">{p.person_name}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">{p.designation_name}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-gray-900"><MapPin size={14} className="text-[#164FA3]" />{p.location_name}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination — controls the page only; the count above is the full set. */}
          {personsPagination.total > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 border-t border-gray-100">
              <div className="text-xs text-gray-500">
                Showing {(personsPagination.page - 1) * personsPagination.pageSize + 1}–{Math.min(personsPagination.page * personsPagination.pageSize, personsPagination.total)} of {personsPagination.total.toLocaleString()} assigned persons
              </div>
              <div className="flex items-center gap-1">
                <button disabled={personsPagination.page <= 1} onClick={() => setPpage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-40 hover:bg-gray-50">Prev</button>
                <span className="text-xs text-gray-500 px-2">Page {personsPagination.page} / {personsPagination.totalPages}</span>
                <button disabled={personsPagination.page >= personsPagination.totalPages} onClick={() => setPpage((p) => Math.min(personsPagination.totalPages, p + 1))}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            </div>
          )}
        </div>
      ) : /* Matrix table: Location → Designation → Assigned Person → Status */
      levelDesignations.length === 0 && !loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-400">
          No {levelLabel}-level designations are configured. Map a designation to the {levelLabel} level in Master Data → Designation.
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">{isState ? "Level" : levelLabel}</th>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">Designation</th>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">Assigned Person</th>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400">No records match the current filters.</td></tr>
                ) : rows.map((r) => (
                  <tr key={`${r.location_id}:${r.designation_id}`} className="hover:bg-gray-50/60">
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 font-medium text-gray-900"><MapPin size={14} className="text-[#164FA3]" />{r.location_name}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">{r.designation_name}</td>
                    <td className="px-4 py-2.5">
                      {r.filled ? (
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                          {r.people.map((p) => (
                            <span key={p.id} className="inline-flex items-center gap-2">
                              <Avatar name={p.person_name} src={p.photo_url} size={28} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-[10px]" />
                              <span className="text-gray-900">{p.person_name}</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">Not Assigned</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.filled
                        ? <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-xs font-semibold"><CheckCircle2 size={12} /> Filled</span>
                        : <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full text-xs font-semibold"><Circle size={12} /> Blank</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function CountCard({ label, value, tone, hint, onClick, active }) {
  const tones = {
    blue: "bg-[#164FA3]/5 border-[#164FA3]/15 text-[#164FA3]",
    green: "bg-emerald-50 border-emerald-100 text-emerald-700",
    amber: "bg-amber-50 border-amber-100 text-amber-700",
    violet: "bg-violet-50 border-violet-100 text-violet-700",
  };
  const clickable = typeof onClick === "function";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`text-left rounded-2xl border p-4 transition-shadow ${tones[tone]} ${clickable ? "cursor-pointer hover:shadow-sm" : "cursor-default"} ${active ? "ring-2 ring-offset-1 ring-current" : ""}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-0.5">{Number(value || 0).toLocaleString()}</div>
      {hint ? <div className="text-[11px] font-medium opacity-60 mt-0.5">{hint}</div> : null}
    </button>
  );
}
