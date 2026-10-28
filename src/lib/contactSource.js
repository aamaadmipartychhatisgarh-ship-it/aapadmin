import { query } from "@/lib/db";

// Contact SOURCE (where a contact came from). Reuses the existing contacts.source column and the
// link to the originating Unfiltered record (contacts.source_unfiltered_contact_id) — no extra field.
// A contact counts as "from Unfiltered Calls" when EITHER is set, so the tag also survives on an
// existing contact that was only UPDATED from Unfiltered Calls (it keeps its own `source` value).
export const SOURCE_UNFILTERED = "unfiltered_calls";
export const SOURCE_LABELS = { [SOURCE_UNFILTERED]: "Unfiltered Calls" };

// The columns are added lazily (first Unfiltered sync); until then the filter must not reference
// them. Positive results are cached for good, negative ones only briefly.
let cache = null, cacheAt = 0;
async function sourceColumns() {
  if (cache && (cache.source || cache.link) && cache.source && cache.link) return cache;
  if (cache && Date.now() - cacheAt < 15000) return cache;
  const rows = await query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND COLUMN_NAME IN ('source', 'source_unfiltered_contact_id')`
  );
  const have = new Set(rows.map((r) => r.c));
  cache = { source: have.has("source"), link: have.has("source_unfiltered_contact_id") };
  cacheAt = Date.now();
  return cache;
}

// SQL condition: the contact originated from (or was updated from) Unfiltered Calls.
async function fromUnfilteredSql(alias) {
  const t = alias ? `${alias}.` : "";
  const c = await sourceColumns();
  const parts = [];
  if (c.source) parts.push(`${t}source = '${SOURCE_UNFILTERED}'`);
  if (c.link) parts.push(`${t}source_unfiltered_contact_id IS NOT NULL`);
  return parts.length ? `(${parts.join(" OR ")})` : null;
}

// ?source=unfiltered_calls → " AND (…)" (matches nothing before any contact has that source).
export async function sourceFilterClause(value, alias = "c") {
  if (String(value || "") !== SOURCE_UNFILTERED) return { where: "", params: [] };
  const cond = await fromUnfilteredSql(alias);
  return { where: ` AND ${cond || "1 = 0"}`, params: [] };
}

// Searching "unfiltered" (or "unfiltered calls") also finds the contacts from that source.
// Returns an OR-able SQL fragment ("" when the term can't mean the source).
export async function sourceSearchOr(term, alias = "c") {
  const q = String(term || "").trim().toLowerCase();
  if (q.length < 4 || !"unfiltered calls".includes(q)) return "";
  const cond = await fromUnfilteredSql(alias);
  return cond ? ` OR ${cond}` : "";
}

// Wrong Number page: the original-source columns to SELECT (only those that exist - they are added lazily),
// and the ?source= filter (unfiltered_calls | registration | none = no source recorded).
let wnCols = null, wnAt = 0;
async function wnSourceColumns() {
  if (wnCols && wnCols.size === 3) return wnCols;
  if (wnCols && Date.now() - wnAt < 15000) return wnCols;
  const rows = await query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND COLUMN_NAME IN ('source', 'source_unfiltered_contact_id', 'source_registration_id')`
  );
  wnCols = new Set(rows.map((r) => r.c)); wnAt = Date.now();
  return wnCols;
}
export async function sourceSelectSql(alias = "c") {
  const have = await wnSourceColumns();
  return ["source", "source_unfiltered_contact_id", "source_registration_id"].map((n) => (have.has(n) ? `${alias}.${n}` : `NULL AS ${n}`)).join(", ");
}
export async function wrongNumberSourceFilter(value, alias = "c") {
  const v = String(value || "");
  if (!["unfiltered_calls", "registration", "none"].includes(v)) return "";
  const have = await wnSourceColumns();
  const col = (n) => (have.has(n) ? `${alias}.${n}` : "NULL");
  const unf = `(COALESCE(${col("source")}, '') = '${SOURCE_UNFILTERED}' OR ${col("source_unfiltered_contact_id")} IS NOT NULL)`;
  const reg = `${col("source_registration_id")} IS NOT NULL`;
  if (v === "unfiltered_calls") return unf;
  if (v === "registration") return `(${reg} AND NOT ${unf})`;
  return `(NOT ${unf} AND NOT (${reg}) AND (${col("source")} IS NULL OR TRIM(${col("source")}) = ''))`;
}
