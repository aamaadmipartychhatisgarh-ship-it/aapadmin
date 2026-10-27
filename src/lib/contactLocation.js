import { query } from "@/lib/db";

// Shared by the Contact edit (PUT /api/contacts/[id]) and the Unfiltered Calls edit.

// Block / Ward is typed as free text. Resolve the name to a `ward` location row under the given
// assembly (reusing an existing one, case-insensitively, or creating it) and return its id.
// A blank name → null (no block). No assembly → the ward is looked up / created without a parent.
export async function resolveOrCreateWard(name, assemblyId) {
  const wn = typeof name === "string" ? name.trim() : "";
  if (!wn) return null;
  const asm = assemblyId || null;
  const found = await query(
    "SELECT id FROM locations WHERE type = 'ward' AND LOWER(name) = LOWER(?) AND (parent_id <=> ?) LIMIT 1",
    [wn, asm]
  );
  if (found[0]?.id) return found[0].id;
  const res = await query("INSERT INTO locations (type, name, parent_id) VALUES ('ward', ?, ?)", [wn, asm]);
  return res.insertId;
}

// id → { id, name, type, parent_id } for the given location ids (missing ids are absent).
export async function locationsById(ids) {
  const clean = [...new Set(ids.filter((x) => x != null).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!clean.length) return new Map();
  const rows = await query(`SELECT id, name, type, parent_id FROM locations WHERE id IN (${clean.map(() => "?").join(",")})`, clean);
  return new Map(rows.map((r) => [r.id, r]));
}
