import { DESIGNATION_NAMES_SQL } from "@/lib/contactDesignations";

// Server-side sorting for the Contacts list + exports. The whitelist maps a small
// set of client sort keys to safe SQL ORDER expressions — so the sort is applied
// in the database over the COMPLETE filtered dataset (never a client-side sort of
// one page), and the SAME order is reused by the Excel / PDF / Print exports.
//
// Every alias used here (c, w, dsg, cz, lz, cls, lls, ld, la) exists in BOTH the
// list query and the export query (contactExport.fetchContactExportRows), and the
// designation subquery is alias-independent (keyed on c.id), so ONE expression
// sorts screen and export identically. Only columns guaranteed to exist in every
// deployment are listed, so ORDER BY can never reference a missing column.
const SORT_COLUMNS = {
  name: "c.person_name",
  phone: "c.phone_number",
  designation: `COALESCE(${DESIGNATION_NAMES_SQL}, NULLIF(TRIM(w.position), ''), dsg.name)`,
  zone: "COALESCE(cz.name, lz.name)",
  lok_sabha: "COALESCE(cls.name, lls.name)",
  district: "ld.name",
  assembly: "la.name",
  address: "c.address",
};

// All whitelisted columns are text; blanks are pushed to the end (both
// directions) and the case-insensitive column collation gives natural A–Z / Z–A.
// A stable id tiebreaker keeps paging deterministic. Numeric/int columns, were
// any added here, would sort by their native type automatically (so "2,10,100"
// orders numerically, not lexically).
export function buildContactOrderBy(sort, dir) {
  const key = String(sort || "").trim();
  const expr = SORT_COLUMNS[key];
  if (!expr) return null; // unknown/blank → caller keeps its default order
  const direction = String(dir || "").toLowerCase() === "desc" ? "DESC" : "ASC";
  return `(${expr} IS NULL OR ${expr} = '') ASC, ${expr} ${direction}, c.id DESC`;
}

// The sort keys the UI may offer (kept in one place so the client and server
// agree on what is sortable).
export const SORTABLE_KEYS = Object.keys(SORT_COLUMNS);

// --- Default Contact List order: photo first, then designation priority -------
// Priority 1: contacts WITH a photo come first.
// Priority 2: within each group, designation level State → Lok Sabha → District
//             → Assembly → Block → Member (unknown last).
// Priority 3: a stable, deterministic tiebreak (existing default) so equal-rank
//             rows never shuffle between page loads.
// Every expression uses only aliases present in BOTH the list and export queries
// (c, w, dsg) plus the alias-independent contact_designations subquery (keyed on
// c.id), so screen and exports order identically — at the DB level, BEFORE
// pagination — and no rows are ever loaded into Node just to sort.

// A contact HAS a photo when its resolved photo (own, else the linked worker's)
// is a non-empty stored reference — the SAME definition the has_photo count and
// the displayed photo use, so the group a contact lands in matches what is shown.
export const CONTACT_PHOTO_AVAILABLE_SQL =
  `(COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) IS NOT NULL)`;

// Map a designation TEXT value to its level number (1..6); 7 = unknown/other.
// Keyword + case-insensitive, so spelling/casing variants map correctly (§12);
// a higher level wins when several keywords appear. Never alphabetical (§14).
function levelCase(col) {
  return `CASE
    WHEN LOWER(${col}) LIKE '%state%' THEN 1
    WHEN LOWER(${col}) LIKE '%lok%sabha%' THEN 2
    WHEN LOWER(${col}) LIKE '%district%' THEN 3
    WHEN LOWER(${col}) LIKE '%assembly%' OR LOWER(${col}) LIKE '%vidhan%' THEN 4
    WHEN LOWER(${col}) LIKE '%block%' THEN 5
    WHEN LOWER(${col}) LIKE '%member%' THEN 6
    ELSE 7 END`;
}

// The contact's designation priority: the BEST (lowest) level among its MANY
// designations (indexed subquery on contact_designations.contact_id — no N+1);
// else the linked worker's position text; else the legacy single designation;
// else 7. An unknown/odd value never hides a contact or breaks the sort — it just
// sorts last within its photo group (§13).
export const CONTACT_DESIGNATION_PRIORITY_SQL = `COALESCE(
  (SELECT MIN(${levelCase("dd.name")})
     FROM contact_designations cd JOIN designations dd ON dd.id = cd.designation_id
    WHERE cd.contact_id = c.id),
  NULLIF(${levelCase("w.position")}, 7),
  NULLIF(${levelCase("dsg.name")}, 7),
  7)`;

// The full default ORDER BY expression (used by the list AND the exports when no
// explicit column sort is chosen, so they always agree).
export const CONTACT_DEFAULT_ORDER_BY =
  `${CONTACT_PHOTO_AVAILABLE_SQL} DESC, ${CONTACT_DESIGNATION_PRIORITY_SQL} ASC, c.is_completed ASC, c.id DESC`;
