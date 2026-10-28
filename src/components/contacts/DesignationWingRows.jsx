"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { wingShortLabel } from "@/lib/wingLabel";

// The Designation + Wing field of the Add / Edit Contact forms: ONE row = ONE Designation paired
// with ITS Wing ("Main Organisation" or a Master-Data Wing). "Add Designation" inserts another
// row directly below; every row is independent, and each is saved as its own combination.
// rows: [{ designation_id: "" | number, wing: "" }]   wing "" = Main Organisation.
// designations: the Designation master (each with .wings / .wing); wingMaster: /api/wings entries.
const sel = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white";

export default function DesignationWingRows({ rows, onChange, designations: designationsProp = [], wingMaster = [] }) {
  // The Designation options ALWAYS come from Master Data (/api/designations): the list the form was given, re-read
  // whenever a Wing is changed so a designation added / re-mapped / disabled in Master Data shows up without reopening.
  const [fresh, setFresh] = useState(null);
  const designations = fresh || designationsProp;
  const reload = () => fetch("/api/designations", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.designations) setFresh(d.designations); return d?.designations || null; }).catch(() => null);
  const mainLc = new Set(wingMaster.filter((w) => w.is_main).map((w) => String(w.name).trim().toLowerCase()));
  const wings = wingMaster.filter((w) => !w.is_main);
  // The Main Wing's name comes from Master Data (Administration -> Master Data -> Wing) - never a hardcoded list. While the
  // master is still loading (or unavailable) the blank option still reads "Main" so a selection is always possible.
  const mainLabel = wingShortLabel(wingMaster.find((w) => w.is_main)?.name) || "Main";   // the Main option reads "Main" (the stored value stays blank = Main Organisation)
  const wingsOf = (d) => (d.wings && d.wings.length ? d.wings : d.wing ? [d.wing] : []).map((w) => String(w).trim().toLowerCase());
  // Is this designation mapped to the Wing? A named Wing: the designation lists it. The Main Wing (blank): the designation
  // has no Wing at all, or lists the Main Wing (also when it is shared with other Wings). One that belongs ONLY to other
  // Wings is never offered.
  const inWing = (d, wingLc) => {
    const dw = wingsOf(d);
    return wingLc ? dw.includes(wingLc) : (dw.length === 0 || dw.some((x) => mainLc.has(x)));
  };
  const optionsFor = (row, idx) => {
    const taken = new Set(rows.filter((_, i) => i !== idx).map((r) => String(r.designation_id || "")).filter(Boolean));
    const w = String(row.wing || "").trim().toLowerCase();
    return designations.filter((d) => {
      if (taken.has(String(d.id))) return false;
      if (String(d.id) === String(row.designation_id)) return true; // keep the saved choice visible
      if (d.enabled === 0) return false;                             // switched off in Master Data
      return inWing(d, w);
    });
  };
  const set = (idx, patch) => onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const wingTaken = (idx) => new Set(rows.filter((r, i) => i !== idx && !r.designation_id && r.wing).map((r) => r.wing));

  return (
    <div className="space-y-2" data-testid="designation-wing-rows">
      {rows.map((r, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_auto] gap-2 items-start border border-gray-100 rounded-xl p-2.5 bg-gray-50/60" data-testid="designation-wing-row">
          <div className="space-y-2 min-w-0">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Wings</label>
              <select className={sel} aria-label={`Wing ${idx + 1}`} data-testid="dw-wing" value={r.wing || ""} title={r.wing || mainLabel}
                onChange={(e) => {
                  const wing = e.target.value;
                  const w = wing.trim().toLowerCase();
                  // Changing the Wing clears only THIS row's designation, and only when it is no longer mapped to the new Wing.
                  const apply = (list) => {
                    const d = list.find((x) => String(x.id) === String(r.designation_id));
                    set(idx, { wing, designation_id: !d || inWing(d, w) ? r.designation_id : "" });
                  };
                  apply(designations);
                  reload().then((list) => { const d = list?.find((x) => String(x.id) === String(r.designation_id)); if (d && !inWing(d, w)) apply(list); });   // refresh the options from Master Data
                }}>
                <option value="">{mainLabel}</option>
                {wings.map((w) => <option key={w.name} value={w.name} disabled={wingTaken(idx).has(w.name) && !r.designation_id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Designation{idx === 0 ? "" : ` ${idx + 1}`}</label>
              <select className={sel} aria-label={`Designation ${idx + 1}`} data-testid="dw-designation" value={r.designation_id ? String(r.designation_id) : ""}
                onChange={(e) => set(idx, { designation_id: e.target.value ? Number(e.target.value) : "" })}>
                <option value="">Select designation…</option>
                {optionsFor(r, idx).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <button type="button" onClick={() => onChange(rows.length > 1 ? rows.filter((_, i) => i !== idx) : [{ designation_id: "", wing: "" }])}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" aria-label={`Remove row ${idx + 1}`} data-testid="dw-remove" title="Remove this row">
            <X size={15} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { designation_id: "", wing: "" }])} data-testid="dw-add"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#164FA3] hover:bg-blue-50 rounded-lg px-2.5 py-1.5">
        <Plus size={15} /> Add Designation
      </button>
    </div>
  );
}
