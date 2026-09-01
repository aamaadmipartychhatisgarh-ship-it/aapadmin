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
