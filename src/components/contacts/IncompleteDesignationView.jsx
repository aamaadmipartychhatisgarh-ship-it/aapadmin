"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Network, MapPin, ChevronRight } from "lucide-react";
import Avatar from "@/components/Avatar";

// CONTACTS → INCOMPLETE DESIGNATION — Level & Designation-wise assignment.
// Select a Level → see EVERY location at that level, and under each ONLY the
// designations mapped to that exact level, each with the assigned person
// (Photo + Name + Designation) or a "Not Assigned" state. Optionally narrow by a
// single designation. Everything is fetched live from the DB — nothing hardcoded.
const LEVELS = [
  { key: "state", label: "State" },
  { key: "zone", label: "Zone" },
  { key: "lok_sabha", label: "Lok Sabha" },
  { key: "district", label: "District" },
  { key: "assembly", label: "Assembly" },
  { key: "block", label: "Block" },
];

const inp = "h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 outline-none focus:border-[#164FA3] focus:ring-1 focus:ring-[#164FA3]";

export default function IncompleteDesignationView() {
  const [level, setLevel] = useState("state");
  const [designationId, setDesignationId] = useState("");
  const [data, setData] = useState({ groups: [], level_designations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState({}); // location id → expanded

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ level });
    if (designationId) p.set("designation_id", designationId);
    fetch(`/api/contacts/incomplete?${p}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load."))))
      .then((d) => { setData(d); setError(""); })
      .catch((e) => setError(e.message || "Failed to load."))
      .finally(() => setLoading(false));
  }, [level, designationId]);

  useEffect(() => { load(); }, [load]);
  // Changing the level clears the designation (its options depend on the level).
  useEffect(() => { setDesignationId(""); }, [level]);

  const groups = data.groups || [];
  const levelDesignations = data.level_designations || [];
  const levelLabel = LEVELS.find((l) => l.key === level)?.label || level;
  const isState = level === "state";

  // Totals — assigned people across the current view (from the DB response).
  const assignedTotal = useMemo(
    () => groups.reduce((s, g) => s + g.designations.reduce((t, d) => t + d.people.length, 0), 0),
    [groups]
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center"><Network size={18} /></div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Incomplete Designation</h2>
          <p className="text-sm text-gray-500">Level &amp; designation-wise assignments — each location shows only its own level&apos;s designations and the assigned person, or “Not Assigned”.</p>
        </div>
      </div>

      {/* Controls: Level + (level-specific) Designation */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Level</label>
          <select className={inp} value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Designation ({levelLabel} level)</label>
          <select className={inp} value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
            <option value="">All {levelLabel} designations</option>
            {levelDesignations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="ml-auto text-sm text-gray-500 self-center">
          {loading ? <span className="inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Loading…</span>
            : <span><strong className="text-gray-900">{assignedTotal.toLocaleString()}</strong> assigned · <strong className="text-gray-900">{groups.length}</strong> {isState ? "location" : `${levelLabel}${groups.length === 1 ? "" : "s"}`}</span>}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2.5 text-sm">{error}</div>}

      {levelDesignations.length === 0 && !loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-400">
          No {levelLabel}-level designations are configured. Map a designation to the {levelLabel} level in Master Data → Designation.
        </div>
      ) : loading && groups.length === 0 ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-400">No {levelLabel.toLowerCase()}s to show.</div>
      ) : isState ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
            <MapPin size={16} className="text-[#164FA3]" />
            <span className="font-bold text-gray-900">State</span>
            <span className="text-xs text-gray-400">— State-level designations</span>
          </div>
          <AssignmentMatrix designations={groups[0].designations} />
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const count = g.designations.reduce((s, d) => s + d.people.length, 0);
            const expanded = open[g.id] ?? groups.length <= 6;
            return (
              <div key={g.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <button onClick={() => setOpen((o) => ({ ...o, [g.id]: !expanded }))} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left">
                  <ChevronRight size={16} className={`text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
                  <MapPin size={16} className="text-[#164FA3]" />
                  <span className="font-bold text-gray-900">{levelLabel}: {g.name}</span>
                  <span className="ml-auto text-xs font-semibold text-gray-500 bg-gray-100 rounded-full px-2.5 py-1">{count} assigned</span>
                </button>
                {expanded && <div className="border-t border-gray-100"><AssignmentMatrix designations={g.designations} /></div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Designation → assigned person(s). Assigned = Avatar + Name + Designation.
// Unassigned = a clear "Not Assigned" state (never a person from elsewhere).
function AssignmentMatrix({ designations }) {
  if (!designations.length) {
    return <div className="px-4 py-4 text-sm text-gray-400">No designations at this level.</div>;
  }
  return (
    <div className="divide-y divide-gray-50">
      {designations.map((d) => (
        <div key={d.id} className="flex items-start gap-4 px-4 py-3">
          <div className="w-56 shrink-0 font-semibold text-gray-800 text-sm pt-1.5">{d.name}</div>
          <div className="flex-1 min-w-0">
            {d.people.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">Not Assigned</span>
            ) : (
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {d.people.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-2">
                    <Avatar name={p.person_name} src={p.photo_url} size={34} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-[11px]" />
                    <span className="leading-tight">
                      <span className="block text-sm text-gray-900">{p.person_name}</span>
                      <span className="block text-[11px] text-gray-500">{p.designation}</span>
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
