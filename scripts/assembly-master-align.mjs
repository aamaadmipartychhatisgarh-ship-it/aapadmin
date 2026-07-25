// Align the assembly master to the official Chhattisgarh list (90):
//  - remove Bhaiyathan (not a real AC)
//  - add Bharatpur (Manendragarh-Chirmiri-Bharatpur / MCB district)
//  - move Bhatgaon + Pratappur from Surguja district to Surajpur district
//
//   node scripts/assembly-master-align.mjs   (transactional, idempotent)

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "aapadmin",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

const ASM_REFS = [
  ["workers", "assembly_id"], ["contacts", "assembly_id"], ["calls", "assembly_id"],
  ["complaints", "assembly_id"], ["assignment_rules", "assembly_id"],
  ["media_library", "assembly_id"], ["users", "scope_assembly_id"],
];
async function tryUpd(sql, p) { try { const [r] = await conn.query(sql, p); return r.affectedRows; } catch (e) { if (["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(e.code)) return 0; throw e; } }

async function idOf(name, type, parentId) {
  const [r] = await conn.query(
    "SELECT id FROM locations WHERE type=? AND name=?" + (parentId ? " AND parent_id=?" : "") + " LIMIT 1",
    parentId ? [type, name, parentId] : [type, name]);
  return r[0]?.id ?? null;
}

await conn.beginTransaction();
try {
  const surguja = await idOf("Surguja", "district");
  const surajpur = await idOf("Surajpur", "district");
  const mcb = await idOf("Manendragarh-Chirmiri-Bharatpur(M C B)", "district");
  if (!surguja || !surajpur || !mcb) throw new Error(`district lookup failed: surguja=${surguja} surajpur=${surajpur} mcb=${mcb}`);

  // 1. Move Bhatgaon + Pratappur -> Surajpur
  for (const nm of ["Bhatgaon", "Pratappur"]) {
    const [r] = await conn.query("UPDATE locations SET parent_id=? WHERE type='assembly' AND name=? AND parent_id=?", [surajpur, nm, surguja]);
    console.log(`  ${nm}: moved to Surajpur (${r.affectedRows} row)`);
  }

  // 2. Remove Bhaiyathan (null its refs first)
  const bh = await idOf("Bhaiyathan", "assembly");
  if (bh) {
    let moved = 0;
    for (const [t, c] of ASM_REFS) moved += await tryUpd(`UPDATE ${t} SET ${c}=NULL WHERE ${c}=?`, [bh]);
    await conn.query("DELETE FROM locations WHERE id=?", [bh]);
    console.log(`  Bhaiyathan (${bh}): removed, ${moved} references set to NULL`);
  } else console.log("  Bhaiyathan: already absent");

  // 3. Add Bharatpur under MCB district (if missing)
  const existingBharatpur = await idOf("Bharatpur", "assembly", mcb);
  if (!existingBharatpur) {
    const [r] = await conn.query("INSERT INTO locations (type, name, parent_id) VALUES ('assembly','Bharatpur',?)", [mcb]);
    console.log(`  Bharatpur: added under MCB district (id ${r.insertId})`);
  } else console.log("  Bharatpur: already present");

  const [[{ cnt }]] = await conn.query("SELECT COUNT(*) cnt FROM locations WHERE type='assembly'");
  console.log(`\nassembly count: ${cnt}`);
  if (cnt !== 90) throw new Error(`expected 90, got ${cnt} — rolling back`);
  await conn.commit();
  console.log("Committed.");
} catch (e) {
  await conn.rollback();
  console.error("Rolled back:", e.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
