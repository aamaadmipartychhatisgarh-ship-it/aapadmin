// Pure helpers (shared by the Add / Edit Contact forms and the API) for the combined
// "Designation + Wing" rows of a contact. A row pairs ONE Designation with ONE Wing:
//   { designation_id: number|null, wing: string }   wing "" = Main Organisation.
// A row with no designation but a Wing is a standalone Wing tag the contact already had.
// The rows are a VIEW over the existing data - contact_designations (+ its paired `wing`) and
// contact_wings - not a separate store.

const clean = (w) => String(w ?? "").trim();
const lc = (w) => clean(w).toLowerCase();

// The Wing a designation row is held under when NO Wing is saved on the row — the same rule the Contact List, its
// Wing filter / search and the exports apply (lib/contactDesignations effectiveWingSql), so the edit form always
// opens showing exactly what the list shows:
//   1. a Wing the contact is tagged with that this designation is mapped to (first in tag order);
//   2. else the Designation master's mapping when unambiguous: exactly one Wing -> it; none -> the Main Wing;
//   3. else "" (mapped to several Wings, none chosen for this contact) -> "Wing not set": the user must choose.
// masterWings: the designation's Wings from the master (designation_wings, else designations.wing).
export function resolveBlankWing({ masterWings = [], tags = [], mainNames = [] }) {
  const main = new Set(mainNames.map(lc));
  const mainName = clean(mainNames[0]);
  const dw = masterWings.map(clean).filter(Boolean);
  const tag = tags.map(clean).find((t) => t && dw.some((w) => lc(w) === lc(t)));
  if (tag) return main.has(lc(tag)) ? mainName : (dw.find((w) => lc(w) === lc(tag)) || tag);
  const uniq = [...new Set(dw.map(lc))];
  if (uniq.length === 1) return main.has(uniq[0]) ? mainName : dw[0];
  if (uniq.length === 0) return mainName;
  return "";
}

// "Main Organisation", "Main Organisations", "Main" … — a saved spelling of the Main Wing.
export const MAIN_ALIAS = /^main(\s+organi[sz]ations?)?$/i;

// pairs: [{ designation_id, wing }] as stored (wing may be null for rows saved before pairing).
// wings: the contact's saved wing names. designationWings: { [designationId]: [wing names] } from the
// master. mainNames: names of the main organisation wing(s). Main is an ORDINARY Wing: a row on it carries the Main
// wing's own name (never a blank placeholder), and a saved Main tag comes back as a row like any other Wing.
// A row with no saved Wing is resolved by resolveBlankWing (and stays "" when that is ambiguous); Wings not used by any
// row come back as standalone Wing rows, so nothing saved is lost.
export function deriveRows({ pairs = [], wings = [], designationWings = {}, mainNames = [] }) {
  const main = new Set(mainNames.map(lc));
  const mainName = clean(mainNames[0]);
  const isMain = (w) => main.has(lc(w)) || (mainName && MAIN_ALIAS.test(clean(w)));
  const have = wings.map(clean).filter(Boolean);
  const used = new Set();
  const rows = [];
  for (const p of pairs) {
    const id = Number(p.designation_id);
    if (!Number.isInteger(id) || id <= 0) continue;
    let wing = clean(p.wing);
    if (!wing) wing = resolveBlankWing({ masterWings: designationWings[id] || designationWings[String(id)] || [], tags: have, mainNames });
    if (wing && isMain(wing)) wing = mainName;                                    // one canonical spelling for Main
    if (wing) used.add(lc(wing));
    rows.push({ designation_id: id, wing });
  }
  for (const w of have) {
    const ww = isMain(w) ? mainName : w;
    if (used.has(lc(ww))) continue;
    used.add(lc(ww));
    rows.push({ designation_id: null, wing: ww });
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
