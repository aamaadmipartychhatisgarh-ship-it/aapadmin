// Diagnostic for the Leader Assessment "With MLA Data" count.
//
// The card counts UNIQUE MLA profiles (one per real/master assembly). If it
// reads higher than the number of MLA profiles you actually maintain, the usual
// cause is a duplicate la_assemblies mirror row for the SAME master assembly
// (same location_id), or a legacy mirror row whose location_id is NULL — either
// gives two MLA rows representing one real assembly.
//
// This script lists every named MLA profile with its mirror's location_id and
// flags: duplicate location_ids (real duplicates) and NULL location_ids (legacy
// / unlinked). It only READS — it changes nothing.
//
//   node scripts/check-la-mla-duplicates.mjs
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});

const [rows] = await conn.query(
  `SELECT mp.id AS mla_id, mp.name AS mla_name, mp.assembly_id,
          a.location_id, a.name AS mirror_name, ml.name AS master_name
     FROM la_mla_profiles mp
     JOIN la_assemblies a ON a.id = mp.assembly_id
     LEFT JOIN locations ml ON ml.id = a.location_id AND ml.type = 'assembly'
    WHERE mp.name IS NOT NULL AND TRIM(mp.name) <> ''
    ORDER BY a.location_id IS NULL, a.location_id, mp.id`
);

const plainCount = rows.length;
const byLoc = new Map();
let nullLoc = 0;
for (const r of rows) {
  if (r.location_id == null) { nullLoc++; continue; }
  byLoc.set(r.location_id, (byLoc.get(r.location_id) || 0) + 1);
}
const uniqueCount = [...byLoc.keys()].length + nullLoc; // matches the card's DISTINCT logic

console.log("Named MLA profile rows (old COUNT*):", plainCount);
console.log("Unique MLA profiles (card value)   :", uniqueCount);
console.log("");
console.log("mla_id  assembly_id  location_id  master/mirror name");
console.log("-".repeat(64));
for (const r of rows) {
  const flag = r.location_id == null
    ? "  ⚠ legacy (no master link)"
    : (byLoc.get(r.location_id) > 1 ? "  ✗ DUPLICATE location_id" : "");
  console.log(
    String(r.mla_id).padEnd(7),
    String(r.assembly_id).padEnd(12),
    String(r.location_id ?? "NULL").padEnd(12),
    `${r.master_name || r.mirror_name || "?"} — MLA: ${r.mla_name}${flag}`
  );
}

const dupLocs = [...byLoc.entries()].filter(([, n]) => n > 1);
if (dupLocs.length) {
  console.log("\nDuplicate mirror location_ids:", dupLocs.map(([l, n]) => `${l}×${n}`).join(", "));
  console.log("These are the extra rows inflating the count. Keep the mirror row");
  console.log("that has the real assessment data and remove/merge the duplicate");
  console.log("la_assemblies row (and its MLA) during a maintenance window.");
} else if (nullLoc) {
  console.log("\nNo duplicate location_ids; the extra rows are legacy (NULL location_id).");
} else {
  console.log("\nNo duplicates found — the plain and unique counts match.");
}

await conn.end();
