import { query } from "@/lib/db";

// A worker's `position` is one or more comma-separated designation names.
// Contacts carry a single designation_id, so map the first name that matches
// the master designations list (returns null if none / no match).
export async function resolvePrimaryDesignationId(position) {
  if (!position) return null;
  const first = String(position).split(",")[0].trim();
  if (!first) return null;
  const rows = await query("SELECT id FROM designations WHERE name = ? LIMIT 1", [first]);
  return rows[0]?.id ?? null;
}
