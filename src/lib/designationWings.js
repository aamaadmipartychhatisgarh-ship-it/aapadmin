import { query } from "@/lib/db";

// ONE designation entry carries MANY Wings. The wings live in `designation_wings`
// (designation_id, wing), keyed by the Master Data wing NAME (the same stored value
// designations.wing / contact_wings use). `designations.wing` is kept as the FIRST
// selected wing so every older reader still sees a sensible value; wing-aware
// readers use wingsOf()/the junction so a multi-wing designation matches ANY of its
// wings. Legacy per-wing rows (one wing in designations.wing, no junction rows)
// keep working unchanged: their single wing is treated as their wing set.

let ensured = false;
export async function ensureDesignationWingsSchema() {
  if (ensured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS designation_wings (
         designation_id INT NOT NULL,
         wing VARCHAR(120) NOT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (designation_id, wing),
         KEY idx_wing (wing)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    ensured = true;
  } catch (e) {
    console.error("[designationWings] ensure table:", e?.message || e);
    return;
  }
  // The same name may now exist once PER LEVEL (one entry per Level), so the
  // name-only UNIQUE key becomes UNIQUE(name, level). Guarded + idempotent; a
  // failure leaves the old key in place (the create route then reports a clear
  // conflict instead of misbehaving).
  try {
    const hasLevel = (await query("SHOW COLUMNS FROM designations LIKE 'level'")).length > 0;
    if (!hasLevel) return;
    const idx = await query("SHOW INDEX FROM designations");
    const byKey = new Map();
    for (const r of idx) {
      if (r.Non_unique !== 0 || r.Key_name === "PRIMARY") continue;
      if (!byKey.has(r.Key_name)) byKey.set(r.Key_name, []);
      byKey.get(r.Key_name).push(r.Column_name);
    }
    const nameOnly = [...byKey.entries()].find(([, cols]) => cols.length === 1 && cols[0] === "name");
    const already = [...byKey.values()].some((cols) => cols.length === 2 && cols[0] === "name" && cols[1] === "level");
    if (nameOnly && !already) {
      await query(`ALTER TABLE designations DROP INDEX \`${nameOnly[0]}\`, ADD UNIQUE KEY uq_designation_name_level (name, level)`);
    }
  } catch (e) {
    console.error("[designationWings] name+level unique:", e?.message || e);
  }
}

// Map<designationId, string[]> of every wing of each given designation row
// ({ id, wing }): its junction wings, or — for legacy rows — its single wing.
export async function wingsMapFor(rows) {
  await ensureDesignationWingsSchema();
  const map = new Map();
  const ids = rows.map((r) => r.id).filter((x) => x != null);
  if (ids.length) {
    const jr = await query(`SELECT designation_id, wing FROM designation_wings WHERE designation_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at, wing`, ids).catch(() => []);
    for (const j of jr) {
      if (!map.has(j.designation_id)) map.set(j.designation_id, []);
      map.get(j.designation_id).push(j.wing);
    }
  }
  for (const r of rows) {
    const w = map.get(r.id);
    if (w && w.length) continue;
    map.set(r.id, r.wing ? [r.wing] : []);
  }
  return map;
}

// Replace a designation's full wing set; designations.wing mirrors the first wing.
export async function setDesignationWings(id, wings) {
  await ensureDesignationWingsSchema();
  const list = [...new Set((wings || []).map((w) => String(w || "").trim()).filter(Boolean))];
  await query("DELETE FROM designation_wings WHERE designation_id = ?", [id]);
  for (const w of list) {
    // eslint-disable-next-line no-await-in-loop
    await query("INSERT IGNORE INTO designation_wings (designation_id, wing) VALUES (?, ?)", [id, w]);
  }
  const hasWing = (await query("SHOW COLUMNS FROM designations LIKE 'wing'")).length > 0;
  if (hasWing) await query("UPDATE designations SET wing = ? WHERE id = ?", [list[0] ?? null, id]);
  return list;
}
