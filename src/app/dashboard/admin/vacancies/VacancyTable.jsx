"use client";

import { Fragment } from "react";
import { Loader2, CheckCircle2, MapPin, Phone, Lock } from "lucide-react";
import { wingShortLabel } from "@/lib/wingLabel";

// ONE layout for Designation Vacancies (Main Organisation) and Wing Vacancies.
// Both views map their API rows to the same shape (fromMainRow / fromWingRow) and
// render through <VacancyTable>, so the columns, ordering, grouping, status chips
// and responsible-person presentation are identical:
//
//   Level · Lok Sabha · District · Assembly · Wing · Vacant Designation · Status ·
//   Responsible Person · Responsible Person's Designation · Contact
//
// Rows are ordered Level → Lok Sabha → District → Assembly → Wing → Designation,
// with a heading row per location, so several vacancies of one place sit together.

const LEVEL_ORDER = ["state", "lok_sabha", "district", "assembly", "block"];

// line = { kind: "person" | "missing" | "note", contact_id?, name?, designation?, area?, mobile?, note?, extra? }
export function fromMainRow(r) {
  const lines = [];
  if (r.status === "vacant") {
    const byId = new Map((r.responsibles || []).map((rp) => [rp.contact_id, rp]));
    for (const sl of r.responsible_slots || []) {
      if (sl.people.length) {
        for (const h of sl.people) lines.push({ kind: "person", contact_id: h.contact_id, name: h.name, designation: h.designation, area: sl.area, mobile: byId.get(h.contact_id)?.mobile || null, reminder: byId.get(h.contact_id) || null });
      } else {
        lines.push({ kind: "missing", designation: sl.label, area: sl.area, note: sl.note || "Not assigned" });
      }
    }
    // A State Wing post has no upper Wing level — a plain note, not a missing person.
    if (!lines.length && r.responsible_top_level) lines.push({ kind: "note", note: r.responsible_note });
    if (!lines.length) lines.push({ kind: "missing", designation: "—", note: "Responsible person not found" });
  }
  return {
    key: `main:${r.level}:${r.location_id}:${r.designation_id}`,
    level: r.level, level_label: r.level_label, location_id: r.location_id, location_name: r.location_name,
    lok_sabha_name: r.lok_sabha_name, district_name: r.district_name, assembly_name: r.assembly_name, block_name: r.block_name,
    hierarchy_incomplete: !!r.hierarchy_incomplete,
    wing: (r.designation_wings || []).length ? r.designation_wings.map(wingShortLabel).join(", ") : null,
    designation: r.designation_name, designation_sub: null,
    status: r.status,
    holders: r.status === "filled" ? String(r.person_names || "").split(",").map((x) => x.trim()).filter(Boolean) : [],
    // Assigned person(s) of a Filed position, display-only.
    holder_people: r.status === "filled" ? (r.holders || []).map((h) => ({ contact_id: h.contact_id, name: h.name, designation: r.designation_name, mobile: h.mobile || null })) : [],
    review_people: r.review_people || [],
    lines,
  };
}

const WING_MISSING_TEXT = { not_assigned: "Not assigned", review: "Needs review", not_configured: "Not configured in Wing master", no_parent_area: "Parent area missing" };

export function fromWingRow(r) {
  const lines = [];
  const resp = r.responsible;
  if (r.status === "vacant" && resp) {
    if (resp.status === "assigned") {
      for (const h of resp.people) lines.push({ kind: "person", contact_id: h.contact_id, name: h.name, designation: h.designation, area: resp.area, mobile: h.mobile || null });
    } else if (resp.status === "top_level") {
      lines.push({ kind: "note", note: resp.note });
    } else {
      lines.push({ kind: "missing", designation: resp.label, area: resp.area, note: WING_MISSING_TEXT[resp.status] || "Not assigned" });
    }
  }
  return {
    key: `wing:${r.wing}:${r.level}:${r.location_id}:${r.role}`,
    level: r.level, level_label: r.level_label, location_id: r.location_id, location_name: r.location_name,
    lok_sabha_name: r.lok_sabha_name, district_name: r.district_name, assembly_name: r.assembly_name, block_name: null,
    hierarchy_incomplete: false,
    wing: r.wing ? wingShortLabel(r.wing) : null, wing_full: r.wing,
    designation: r.role_label, designation_sub: r.designation_name,
    status: r.status,
    holders: (r.holders || []).map((h) => h.name),
    holder_people: r.status === "filled" ? (r.holders || []).map((h) => ({ contact_id: h.contact_id, name: h.name, designation: h.designation || r.designation_name, mobile: h.mobile || null })) : [],
    review_people: r.review_people || [],
    lines,
    path: r.path,
  };
}

function sortRows(rows) {
  const s = (v) => String(v || "");
  return rows.map((r, i) => ({ r, i })).sort((a, b) =>
    (LEVEL_ORDER.indexOf(a.r.level) - LEVEL_ORDER.indexOf(b.r.level))
    || s(a.r.lok_sabha_name).localeCompare(s(b.r.lok_sabha_name))
    || s(a.r.district_name).localeCompare(s(b.r.district_name))
    || s(a.r.assembly_name).localeCompare(s(b.r.assembly_name))
    || s(a.r.block_name).localeCompare(s(b.r.block_name))
    || s(a.r.location_name).localeCompare(s(b.r.location_name))
    || (a.i - b.i) // keeps the server's Wing + designation order within a location
  ).map((x) => x.r);
}

export function StatusChip({ status }) {
  if (status === "filled") return <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Filled</span>;
  if (status === "review") return <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200" title="A holder exists but their location or Wing mapping is incomplete"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />Needs review</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-300"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Vacant</span>;
}

const ROW_ACCENT = { vacant: "border-l-amber-400", review: "border-l-red-400", filled: "border-l-green-400" };
const dash = <span className="text-gray-300">—</span>;
const areaSuffix = (a) => (a && a !== "State" ? ` (${a})` : "");

// Filled rows are DISPLAY-ONLY on this page: no reminder / edit / delete actions.
function ReadOnlyBadge() {
  return <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400" data-testid="vac-readonly" title="Filled designations are display-only on this page"><Lock size={10} />Display only</span>;
}

function StatusDetail({ row }) {
  if (row.status === "filled") return <div><ReadOnlyBadge /></div>;
  if (row.status === "review") {
    return (row.review_people || []).map((p) => (
      <div key={p.contact_id} className="mt-1 text-[11px] text-gray-600"><span className="font-medium text-gray-900">{p.person_name}</span> — {p.reason}</div>
    ));
  }
  return null;
}

// Locations: "Raipur City North" with "Abhanpur Block A" under its assembly, etc.
function groupTitle(r) {
  if (r.level === "state") return "State";
  return `${r.level_label} · ${r.location_name || "—"}`;
}
function groupTrail(r) {
  return [r.level === "block" ? r.assembly_name : null, r.level !== "assembly" && r.level !== "block" ? null : r.district_name, r.level === "state" || r.level === "lok_sabha" ? null : r.lok_sabha_name]
    .filter((x, i, a) => x && a.indexOf(x) === i).join(" · ");
}

// mode "vacant" (default): Vacant Designation columns (responsible person +
// actions). mode "filed": Filed Designation columns (assigned person, display-only).
export default function VacancyTable({ rows, loading, err, showWing = true, renderContactExtra, mode = "vacant", emptyText = "No positions for these filters.", errorText = "Vacancies could not be calculated — no positions are shown." }) {
  const filed = mode === "filed";
  const sorted = sortRows(rows || []);
  const groups = [];
  for (const r of sorted) {
    const k = `${r.level}:${r.location_id}`;
    if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, head: r, rows: [] });
    groups[groups.length - 1].rows.push(r);
  }
  const cols = showWing ? 10 : 9;
  const counts = (g) => {
    const v = g.rows.filter((x) => x.status === "vacant").length, rv = g.rows.filter((x) => x.status === "review").length, f = g.rows.filter((x) => x.status === "filled").length;
    return [v && `${v} vacant`, rv && `${rv} needs review`, f && `${f} filled`].filter(Boolean).join(" · ");
  };
  // Filed mode: the assigned person(s) — name, designation, mobile — as plain text.
  const Holders = ({ row, field }) => {
    const hp = row.holder_people || [];
    if (!hp.length) return field === "name" ? <span className="text-xs text-gray-500">{row.holders.join(", ") || "—"}</span> : dash;
    return (
      <div className="space-y-1.5">
        {hp.map((h, i) => (
          <div key={h.contact_id || i} className="h-8 flex items-center gap-2 whitespace-nowrap" data-testid="holder-line">
            {field === "name" && <span className="font-semibold text-gray-900">{h.name}</span>}
            {field === "designation" && <span className="text-xs text-gray-700">{h.designation || "—"}</span>}
            {field === "contact" && (h.mobile ? <span className="font-mono text-xs text-gray-700">{h.mobile}</span> : <span className="text-xs text-gray-400">No mobile</span>)}
          </div>
        ))}
      </div>
    );
  };
  const Lines = ({ row, field }) => {
    if (row.status === "filled") return <Holders row={row} field={field} />;
    if (row.status !== "vacant" || !row.lines.length) return dash;
    return (
      <div className="space-y-1.5">
        {row.lines.map((l, i) => (
          // One row per responsible line, never wrapped, so a person's name, designation
          // and contact stay aligned across the three columns.
          <div key={i} className="h-8 flex items-center gap-2 whitespace-nowrap" data-testid={l.kind === "person" ? "resp-line" : "resp-missing"}>
            {field === "name" && (l.kind === "person" ? <span className="font-semibold text-gray-900">{l.name}</span>
              : l.kind === "note" ? <span className="text-gray-500 text-xs">{l.note}</span>
              : <span className="font-semibold text-red-600 text-xs whitespace-nowrap">{l.note}</span>)}
            {field === "designation" && (l.kind === "note" ? dash : <span className={`text-xs ${l.kind === "person" ? "text-gray-700" : "text-red-500"}`}>{l.designation}{areaSuffix(l.area)}</span>)}
            {field === "contact" && (l.kind === "person" ? (
              <>
                {l.mobile ? <a href={`tel:${l.mobile}`} className="inline-flex items-center gap-1 font-mono text-xs text-[#164FA3] hover:underline"><Phone size={11} />{l.mobile}</a> : <span className="text-xs text-gray-400">No mobile</span>}
                {renderContactExtra ? renderContactExtra(l, row) : null}
              </>
            ) : dash)}
          </div>
        ))}
      </div>
    );
  };

  if (loading) return <div className="px-4 py-16 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></div>;
  if (err) return <div className="px-4 py-16 text-center text-gray-400">{errorText}</div>;
  if (!sorted.length) return <div className="px-4 py-16 text-center text-gray-400"><CheckCircle2 size={28} className="mx-auto mb-2 opacity-40" />{emptyText}</div>;

  return (
    <>
      {/* Desktop / tablet: one table, grouped by location. */}
      <div className="hidden md:block overflow-x-auto" data-testid="vacancy-table">
        <table className="w-full text-sm min-w-[1560px]">
          <thead>
            <tr className="bg-gray-50 text-left text-gray-500 text-[11px] uppercase tracking-wide">
              <th className="px-3 py-3 font-semibold">Level</th>
              <th className="px-3 py-3 font-semibold min-w-[130px]">Lok Sabha</th>
              <th className="px-3 py-3 font-semibold min-w-[130px]">District</th>
              <th className="px-3 py-3 font-semibold min-w-[130px]">Assembly</th>
              {showWing && <th className="px-3 py-3 font-semibold">Wing</th>}
              <th className="px-3 py-3 font-semibold min-w-[180px]">{mode === "combined" ? "Designation" : filed ? "Filled Designation" : "Vacant Designation"}</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold">{mode === "combined" ? "Assigned / Responsible Person" : filed ? "Assigned Person" : "Responsible Person"}</th>
              <th className="px-3 py-3 font-semibold">{mode === "combined" ? "Person\u2019s Designation" : filed ? "Assigned Person\u2019s Designation" : "Responsible Person\u2019s Designation"}</th>
              <th className="px-3 py-3 font-semibold">Contact</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.key}>
                <tr className="bg-slate-50 border-t border-gray-200" data-testid="vac-group">
                  <td colSpan={cols} className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-gray-800"><MapPin size={14} className="text-[#164FA3]" />{groupTitle(g.head)}</span>
                    {groupTrail(g.head) && <span className="ml-2 text-xs text-gray-500">{groupTrail(g.head)}</span>}
                    {g.head.hierarchy_incomplete && <span className="ml-2 text-xs text-red-500">Parent area missing in master</span>}
                    <span className="ml-3 text-xs text-gray-500">{counts(g)}</span>
                  </td>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.key} data-testid="vac-row" data-status={r.status} data-level={r.level} data-wing={r.wing_full || r.wing || ""}
                    className={`align-top border-t border-gray-100 border-l-4 ${ROW_ACCENT[r.status] || ""} hover:bg-gray-50`}>
                    <td className="px-3 py-2.5" data-testid="vac-level"><span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">{r.level_label}</span></td>
                    <td className="px-3 py-2.5 text-gray-700" data-testid="vac-ls">{r.level === "state" ? dash : (r.lok_sabha_name || dash)}</td>
                    <td className="px-3 py-2.5 text-gray-700" data-testid="vac-district">{r.district_name || dash}</td>
                    <td className="px-3 py-2.5 text-gray-700" data-testid="vac-assembly">
                      {r.assembly_name || dash}
                      {r.block_name && <span className="block text-[11px] text-gray-500">Block: {r.block_name}</span>}
                    </td>
                    {showWing && (
                      <td className="px-3 py-2.5" data-testid="vac-wing">
                        {r.wing ? <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-200 whitespace-nowrap">{r.wing}</span> : <span className="text-xs text-gray-400">Main</span>}
                      </td>
                    )}
                    <td className="px-3 py-2.5" data-testid="vac-designation">
                      <span className="font-semibold text-gray-900">{r.designation}</span>
                      {r.designation_sub && <span className="block text-[11px] text-gray-400">{r.designation_sub}</span>}
                    </td>
                    <td className="px-3 py-2.5" data-testid="vac-status"><StatusChip status={r.status} /><StatusDetail row={r} /></td>
                    <td className="px-3 py-2.5" data-testid="vac-resp-name"><Lines row={r} field="name" /></td>
                    <td className="px-3 py-2.5" data-testid="vac-resp-designation"><Lines row={r} field="designation" /></td>
                    <td className="px-3 py-2.5" data-testid="vac-contact"><Lines row={r} field="contact" /></td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: the same information as stacked cards, same grouping. */}
      <div className="md:hidden divide-y divide-gray-200" data-testid="vacancy-cards">
        {groups.map((g) => (
          <div key={g.key} className="py-2">
            <div className="px-3 py-1.5 text-[13px] font-bold text-gray-800 flex items-center gap-1.5"><MapPin size={14} className="text-[#164FA3]" />{groupTitle(g.head)}
              <span className="font-normal text-xs text-gray-500">{groupTrail(g.head)}</span></div>
            {g.rows.map((r) => (
              <div key={r.key} className={`mx-3 my-2 rounded-lg border border-gray-200 border-l-4 ${ROW_ACCENT[r.status] || ""} p-3`} data-testid="vac-card" data-status={r.status}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-gray-900">{r.designation}</div>
                    <div className="text-[11px] text-gray-500">{[r.level_label, r.wing ? `${r.wing} Wing` : null].filter(Boolean).join(" · ")}</div>
                  </div>
                  <StatusChip status={r.status} />
                </div>
                <StatusDetail row={r} />
                {r.status === "filled" && (r.holder_people || []).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Assigned</div>
                    {r.holder_people.map((h, i) => (
                      <div key={h.contact_id || i} className="text-xs" data-testid="holder-line">
                        <span className="font-semibold text-gray-900">{h.name}</span>
                        <span className="text-gray-500"> · {h.mobile || "No mobile"}</span>
                      </div>
                    ))}
                  </div>
                )}
                {r.status === "vacant" && r.lines.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-100 space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Responsible</div>
                    {r.lines.map((l, i) => (
                      <div key={i} className="text-xs">
                        {l.kind === "person" ? (
                          <>
                            <span className="font-semibold text-gray-900">{l.name}</span>
                            <span className="text-gray-500"> · {l.designation}{areaSuffix(l.area)}</span>
                            <div className="flex items-center gap-2 mt-0.5">
                              {l.mobile ? <a href={`tel:${l.mobile}`} className="font-mono text-[#164FA3]">{l.mobile}</a> : <span className="text-gray-400">No mobile</span>}
                              {renderContactExtra ? renderContactExtra(l, r) : null}
                            </div>
                          </>
                        ) : l.kind === "note" ? <span className="text-gray-500">{l.note}</span>
                          : <span className="text-red-600"><span className="font-semibold">{l.note}</span> · {l.designation}{areaSuffix(l.area)}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// All ↔ Vacant Designation ↔ Filled Designation switch. A position is in exactly one category:
// Filled when a valid person is assigned, else Vacant (including "needs review", where no valid
// assignment exists yet). "All" (when allCount is given) lists both together. `view` =
// "all" | "vacant" | "filed"; `filed` (legacy boolean) is used when `view` is not passed.
export function CategorySwitch({ filed, view, allCount, vacantCount, filedCount, onChange }) {
  const cur = view || (filed ? "filed" : "vacant");
  const btn = (k, label, n, active) => (
    <button key={k} role="tab" aria-selected={active} data-testid={`vac-category-${k}`} onClick={() => onChange(k)}
      className={`h-8 px-3 rounded-md text-sm font-semibold inline-flex items-center gap-1.5 ${active ? "bg-[#164FA3] text-white" : "text-gray-600 hover:bg-gray-50"}`}>
      {label}
      <span className={`text-[11px] font-bold px-1.5 rounded-full ${active ? "bg-white/20" : "bg-gray-100 text-gray-600"}`}>{n}</span>
    </button>
  );
  return (
    <div role="tablist" aria-label="Designation category" className="inline-flex border border-gray-200 rounded-lg p-0.5 bg-white">
      {allCount !== undefined && btn("all", "All Designations", allCount, cur === "all")}
      {btn("vacant", "Vacant Designation", vacantCount, cur === "vacant")}
      {btn("filed", "Filled Designation", filedCount, cur === "filed")}
    </div>
  );
}
