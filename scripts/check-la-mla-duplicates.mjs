// Diagnostic for the Leader Assessment "With MLA Data" count.
//
// The Overview card must equal the MLA Data List (/api/leader-assessment/mlas),
// which counts la_mla_profiles that INNER JOIN through la_assemblies to an
// existing MASTER assembly (locations type='assembly'). An MLA whose mirror row
// has a NULL or dangling location_id (a legacy/orphan assembly no longer in
// Master Data) is shown in NEITHER — but a query that joins only la_assemblies
// would still count it, which is the classic "5 vs 4" over-count.
//
// This script prints: every named MLA profile, whether it links to a live master
// assembly, the count the card/list now use (master-linked), and flags the
// orphan rows that used to inflate the number. It only READS.
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
          a.location_id,
          ml.id AS master_id, ml.name AS master_name,
          a.name AS mirror_name
     FROM la_mla_profiles mp
     JOIN la_assemblies a ON a.id = mp.assembly_id
     LEFT JOIN locations ml ON ml.id = a.location_id AND ml.type = 'assembly'
    WHERE mp.name IS NOT NULL AND TRIM(mp.name) <> ''
    ORDER BY master_id IS NULL DESC, mp.id`
);

const linked = rows.filter((r) => r.master_id != null);
const orphans = rows.filter((r) => r.master_id == null);

console.log("Named MLA profile rows (old join-only count):", rows.length);
console.log("Master-linked MLA profiles (card & list value):", linked.length);
console.log("");
console.log("mla_id  assembly_id  location_id  master?  name");
console.log("-".repeat(66));
for (const r of rows) {
  const ok = r.master_id != null;
  console.log(
    String(r.mla_id).padEnd(7),
    String(r.assembly_id).padEnd(12),
    String(r.location_id ?? "NULL").padEnd(12),
    (ok ? "yes    " : "NO     "),
    `${r.master_name || r.mirror_name || "?"} — MLA: ${r.mla_name}${ok ? "" : "   ✗ orphan (not in Master Data)"}`
  );
}

if (orphans.length) {
  console.log(`\n⚠ ${orphans.length} orphan MLA profile(s) point at a la_assemblies row whose`);
  console.log("  master assembly no longer exists (NULL/dangling location_id).");
  console.log("  These are correctly EXCLUDED from the card and the MLA Data List now.");
  console.log("  To fully clean up, delete the orphan la_assemblies row (its MLA cascades)");
  console.log("  during a maintenance window.");
} else {
  console.log("\nNo orphan MLA profiles — the count already matched the MLA Data List.");
}

await conn.end();
