// Pure helpers (shared by the Add / Edit Contact forms and the API) for the combined
// "Designation + Wing" rows of a contact. A row pairs ONE Designation with ONE Wing:
//   { designation_id: number|null, wing: string }   wing "" = Main Organisation.
// A row with no designation but a Wing is a standalone Wing tag the contact already had.
// The rows are a VIEW over the existing data - contact_designations (+ its paired `wing`) and
// contact_wings - not a separate store.

const clean = (w) => String(w ?? "").trim();
const lc = (w) => clean(w).toLowerCase();

// pairs: [{ designation_id, wing }] as stored (wing may be null for rows saved before pairing).
// wings: the contact's saved wing names. designationWings: { [designationId]: [wing names] } from the
// master. mainNames: names of the main organisation wing(s). Main is an ORDINARY Wing: a row on it carries the Main
// wing's own name (never a blank placeholder), and a saved Main tag comes back as a row like any other Wing.
// Unpaired legacy rows take the first of the designation's master wings the contact already has, else - for a designation
// that belongs to no other Wing - Main; Wings not used by any row come back as standalone Wing rows, so nothing saved is lost.
export function deriveRows({ pairs = [], wings = [], designationWings = {}, mainNames = [] }) {
  const main = new Set(mainNames.map(lc));
  const mainName = clean(mainNames[0]);
  const have = wings.map(clean).filter(Boolean);
  const used = new Set();
  const rows = [];
  for (const p of pairs) {
    const id = Number(p.designation_id);
    if (!Number.isInteger(id) || id <= 0) continue;
    let wing = clean(p.wing);
    if (!wing) {
      const cand = (designationWings[id] || designationWings[String(id)] || []).map(clean)
        .find((w) => w && !main.has(lc(w)) && have.some((h) => lc(h) === lc(w)));
      wing = cand || "";
      if (!wing && mainName) {
        const dw = (designationWings[id] || designationWings[String(id)] || []).map(clean).filter(Boolean);
        if (dw.length === 0 || dw.some((w) => main.has(lc(w)))) wing = mainName;   // a legacy blank pair on a general designation = Main
      }
    }
    if (wing && main.has(lc(wing))) wing = mainName;                              // one canonical spelling for Main
    if (wing) used.add(lc(wing));
    rows.push({ designation_id: id, wing });
  }
  for (const w of have) {
    if (used.has(lc(w))) continue;
    used.add(lc(w));
    rows.push({ designation_id: null, wing: main.has(lc(w)) ? mainName : w });
  }
  return rows;
}

// Clean rows from user input: numeric designation ids, trimmed wings, blank rows dropped.
export function normalizeRows(input) {
  const out = [];
  for (const r of Array.isArray(input) ? input : []) {
    const n = parseInt(r?.designation_id, 10);
    const id = Number.isInteger(n) && n > 0 ? n : null;
    const wing = clean(r?.wing).slice(0, 120);
    if (!id && !wing) continue;
    out.push({ designation_id: id, wing });
  }
  return out;
}

const key = (r) => `${r.designation_id ?? ""}|${lc(r.wing)}`;
export function sameRows(a, b) {
  const x = normalizeRows(a).map(key).sort(), y = normalizeRows(b).map(key).sort();
  return x.length === y.length && x.every((k, i) => k === y[i]);
}

// "designationId:Wing" pairs joined by '|' (the contact list's designation_pairs) -> [{ designation_id, wing }].
export function parseDesignationPairs(str) {
  return String(str || "").split("|").map((x) => { const i = x.indexOf(":"); return i < 0 ? null : { designation_id: Number(x.slice(0, i)), wing: x.slice(i + 1) }; }).filter((x) => x && x.designation_id > 0);
}
