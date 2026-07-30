// One-time migration for the auto worker-status feature.
//   1. Expand workers.status enum to include 'pending' (default 'pending').
//   2. Recompute every worker's status from profile completeness — Active only
//      when all 9 mandatory fields are set (Name, Mobile, Designation, Address,
//      Zone, Lok Sabha, District, Assembly, Ward), else Pending.
//
// The completeness expression MUST mirror computeWorkerStatus() in
// src/lib/workerStatus.js (isFilled = not null, trimmed non-empty, not "0").
//
// Run:  node scripts/worker-status-recompute.mjs        (apply)
//       node scripts/worker-status-recompute.mjs --dry  (count only, no writes)
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const DRY = process.argv.includes("--dry");

const COMPLETE = `
  name IS NOT NULL AND TRIM(name) <> ''
  AND mobile IS NOT NULL AND TRIM(mobile) <> ''
  AND position IS NOT NULL AND TRIM(position) <> ''
  AND address IS NOT NULL AND TRIM(address) <> ''
  AND zone_id IS NOT NULL AND zone_id <> 0
  AND lok_sabha_id IS NOT NULL AND lok_sabha_id <> 0
  AND district_id IS NOT NULL AND district_id <> 0
  AND assembly_id IS NOT NULL AND assembly_id <> 0
  AND ward_id IS NOT NULL AND ward_id <> 0`;

const c = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});

try {
  const [[before]] = await c.query(
    `SELECT COUNT(*) total,
       SUM(CASE WHEN ${COMPLETE} THEN 1 ELSE 0 END) will_active,
       SUM(CASE WHEN ${COMPLETE} THEN 0 ELSE 1 END) will_pending
     FROM workers`
  );
  console.log(`workers: ${before.total} → active ${before.will_active} / pending ${before.will_pending}`);
  if (DRY) { console.log("dry run — no changes written."); await c.end(); process.exit(0); }

  // 1) Enum + default. 'inactive' kept for backward compatibility (unused by the
  //    auto logic). Default 'pending' so any insert that omits status is safe.
  await c.query(
    `ALTER TABLE workers MODIFY status ENUM('active','pending','inactive') NOT NULL DEFAULT 'pending'`
  );
  console.log("enum updated: ('active','pending','inactive') default 'pending'");

  // 2) Recompute all.
  const [res] = await c.query(
    `UPDATE workers SET status = CASE WHEN ${COMPLETE} THEN 'active' ELSE 'pending' END`
  );
  console.log(`recomputed ${res.affectedRows} rows.`);

  const [dist] = await c.query(`SELECT status, COUNT(*) n FROM workers GROUP BY status`);
  console.table(dist);
} finally {
  await c.end();
}
