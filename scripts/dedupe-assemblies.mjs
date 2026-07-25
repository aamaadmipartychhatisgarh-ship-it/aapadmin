// Assembly master cleanup: merge the 8 duplicated Chhattisgarh assembly
// constituencies down to one row each (98 -> 90). For each pair we KEEP the row
// that holds the live data, repoint every reference from the removed row onto it,
// fix the kept row's district where needed, then delete the duplicate.
//
//   node scripts/dedupe-assemblies.mjs
// Transactional + idempotent (skips pairs already merged).

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// keep = surviving id, remove = duplicate to delete.
// fixDistrict: set the kept row's parent_id to the removed row's parent (the
// correct new district) before deleting — for the two mis-districted survivors.
const MERGES = [
  { keep: 165, remove: 56 },   // Bilaigarh
  { keep: 161, remove: 128 },  // Khairagarh
  { keep: 163, remove: 133 },  // Mohla-Manpur
  { keep: 160, remove: 106 },  // Samri
  { keep: 164, remove: 95 },   // Sarangarh
  { keep: 159, remove: 105 },  // Ramanujganj
  { keep: 112, remove: 162, fixDistrict: true }, // Manendragarh -> MCB district
  { keep: 102, remove: 114, fixDistrict: true }, // Premnagar   -> Surajpur district
];

// Every column that references an assembly id.
const REFS = [
  ["workers", "assembly_id"], ["contacts", "assembly_id"], ["calls", "assembly_id"],
  ["complaints", "assembly_id"], ["assignment_rules", "assembly_id"],
  ["media_library", "assembly_id"], ["users", "scope_assembly_id"],
];

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "aapadmin",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

async function tryUpdate(sql, params) {
  try { const [r] = await conn.query(sql, params); return r.affectedRows; }
  catch (e) { if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(e.code)) return 0; throw e; }
}

const [[{ cnt: before }]] = await conn.query("SELECT COUNT(*) cnt FROM locations WHERE type='assembly'");
console.log(`assemblies before: ${before}`);

await conn.beginTransaction();
try {
  for (const m of MERGES) {
    const [rm] = await conn.query("SELECT id, name, parent_id FROM locations WHERE id=? AND type='assembly'", [m.remove]);
    if (rm.length === 0) { console.log(`- pair keep=${m.keep} remove=${m.remove}: already merged, skip`); continue; }
    const [kp] = await conn.query("SELECT id, name FROM locations WHERE id=? AND type='assembly'", [m.keep]);
    if (kp.length === 0) throw new Error(`keep id ${m.keep} not found`);

    if (m.fixDistrict) {
      await conn.query("UPDATE locations SET parent_id=? WHERE id=?", [rm[0].parent_id, m.keep]);
      console.log(`  set district of keep=${m.keep} (${kp[0].name}) -> parent ${rm[0].parent_id}`);
    }
    let moved = 0;
    for (const [t, c] of REFS) moved += await tryUpdate(`UPDATE ${t} SET ${c}=? WHERE ${c}=?`, [m.keep, m.remove]);
    const kids = await tryUpdate("UPDATE locations SET parent_id=? WHERE parent_id=?", [m.keep, m.remove]);
    await conn.query("DELETE FROM locations WHERE id=?", [m.remove]);
    console.log(`  merged "${rm[0].name}" (${m.remove}) -> ${m.keep}: repointed ${moved} refs, ${kids} child locations, deleted`);
  }

  const [[{ cnt: after }]] = await conn.query("SELECT COUNT(*) cnt FROM locations WHERE type='assembly'");
  console.log(`\nassemblies after: ${after}`);
  if (after !== 90) throw new Error(`expected 90 assemblies, got ${after} — rolling back`);
  await conn.commit();
  console.log("Committed. Assembly master now has exactly 90 rows.");
} catch (e) {
  await conn.rollback();
  console.error("Rolled back:", e.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
