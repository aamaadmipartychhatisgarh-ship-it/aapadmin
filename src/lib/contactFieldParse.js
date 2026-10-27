import { QUALIFICATIONS, EDUCATION_LEVELS } from "@/lib/qualificationOptions";
import { VEHICLES } from "@/lib/vehicleOptions";
import { normalizeQualification } from "@/lib/contactQualification";
import { normalizeVehicle } from "@/lib/contactVehicle";
import { CLEAR_TOKEN } from "@/lib/contactFieldConfig";

// Shared cell parsers for the Contact field values, used by BOTH Import Excel (new contacts) and Import Edit
// (existing contacts), so a value means the same thing in either.
const Q_LABEL = Object.fromEntries(QUALIFICATIONS.map((q) => [q.label.toLowerCase(), q.value]));
const E_LABEL = Object.fromEntries(EDUCATION_LEVELS.map((e) => [e.label.toLowerCase(), e.value]));
const E_VALUES = new Set(EDUCATION_LEVELS.map((e) => e.value));
const V_LABEL = Object.fromEntries(VEHICLES.map((v) => [v.label.toLowerCase(), v.value]));
const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const isClear = (v) => str(v).toLowerCase() === CLEAR_TOKEN;

// Qualification + Education Level cells (+ the contact's current values) -> { qualification, education_level } to
// store, { unchanged: true } when both cells are blank, or { error }. "Literate", "Illiterate" and the exported
// "Literate – 12th" are all accepted; [clear] empties both; a level needs Literate.
export function parseQualificationCells(qCell, eCell, cur = {}) {
  const qv = str(qCell), ev = str(eCell);
  if (!qv && !ev) return { unchanged: true };
  let q = cur.qualification || "", e = cur.education_level || "";
  if (isClear(qv)) { q = ""; e = ""; }
  else {
    if (qv) {
      const m = qv.toLowerCase().split(/\s*[–-]\s*/);
      const qq = Q_LABEL[m[0]] ?? Q_LABEL[qv.toLowerCase()] ?? null;
      if (!qq) return { error: `Invalid Qualification "${qv}" (Illiterate or Literate)` };
      q = qq;
      if (qq === "illiterate") e = "";
      if (m[1]) { const el = E_LABEL[m[1].trim()]; if (!el) return { error: `Invalid education level "${m[1]}"` }; e = el; }
    }
    if (ev) {
      if (isClear(ev)) e = "";
      else {
        const el = E_LABEL[ev.toLowerCase()] || (E_VALUES.has(ev.toLowerCase()) ? ev.toLowerCase() : null);
        if (!el) return { error: `Invalid Education Level "${ev}" (${EDUCATION_LEVELS.map((x) => x.label).join(", ")})` };
        if (q !== "literate") return { error: "An Education Level needs Qualification = Literate" };
        e = el;
      }
    }
  }
  const n = normalizeQualification({ qualification: q, education_level: e });
  if (n.error) return { error: n.error };
  return { qualification: n.qualification, education_level: n.education_level };
}

// Vehicle cell -> { vehicle } (null clears) | { unchanged } | { error }.
export function parseVehicleCell(cell) {
  const v = str(cell);
  if (!v) return { unchanged: true };
  const to = isClear(v) ? "" : (V_LABEL[v.toLowerCase()] || v.toLowerCase().replace(/\s+/g, "_"));
  const n = normalizeVehicle({ vehicle: to });
  if (n.error) return { error: `Invalid Vehicle "${v}" (Two Wheeler or Four Wheeler)` };
  return { vehicle: n.vehicle };
}

// Status cell -> { is_completed: 0|1 } | { unchanged } (blank / the informational "Assigned" / "Pool") | { error }.
export function parseStatusCell(cell) {
  const v = str(cell).toLowerCase();
  if (!v || v === "assigned" || v === "pool") return { unchanged: true };
  if (v === "done") return { is_completed: 1 };
  if (v === "pending") return { is_completed: 0 };
  return { error: `Invalid Status "${str(cell)}" (Pending or Done)` };
}
