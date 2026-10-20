import { query } from "@/lib/db";

// Assembly reservation category — server helpers. Options/labels live in
// assemblyCategoryOptions.js (client-safe) and are re-exported here.
export { ASSEMBLY_CATEGORIES, ASSEMBLY_CATEGORY_VALUES, ASSEMBLY_CATEGORY_LABEL, normalizeAssemblyCategory } from "@/lib/assemblyCategoryOptions";

// Additive, nullable column — created once per process; existing rows stay NULL.
let ensured = false;
export async function ensureAssemblyCategoryColumn() {
  if (ensured) return true;
  try {
    const [row] = await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations' AND COLUMN_NAME = 'reservation_category'`
    );
    if (!Number(row?.n)) await query("ALTER TABLE locations ADD COLUMN reservation_category VARCHAR(8) NULL");
    ensured = true;
  } catch (e) {
    console.error("[assemblyCategory] ensureAssemblyCategoryColumn:", e?.message || e);
  }
  return ensured;
}
