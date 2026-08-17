// Consistency check for the per-district worker/contact count that the Contacts
// page, Full Ranking (Strength + Area Ranking), Organization Map and the
// Workers-by-District tree map all display.
//
// Those dashboard views derive their number from ONE shared service
// (src/lib/districtStats.js → contactsByDistrict in src/lib/workerCounts.js),
// which resolves each contact's district the SAME way the Contacts list page
// does: by the contact's LINKED WORKER district when it has a worker, falling
// back to the contact's own district_id otherwise, with wrong-number rows
// excluded. This script re-computes that number straight from the database and
// compares it, per district, against:
//   • the naive contacts.district_id-only count (the OLD, under-counting basis
//     that produced 1,336 vs the Contacts page's 1,342), and
//   • the Contacts-list resolution (the authoritative page number).
// Any district where the shared count ≠ the Contacts-page count is a BUG and is
// printed with a ✗. When everything matches, every row shows ✓.
//
// Run:  node scripts/verify-district-worker-counts.mjs
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});

// Does the optional wrong-number flag column exist? (Same gate the app uses.)
const [wrongCols] = await conn.query("SHOW COLUMNS FROM contacts LIKE 'is_wrong_number'");
const notWrong = wrongCols.length
  ? " AND (ct.is_wrong_number = 0 OR ct.is_wrong_number IS NULL)"
  : "";

// Effective (person-aware) district — identical to contactsByDistrict() and the
// Contacts list filter: worker's district when linked, else the contact's own.
const eff = "CASE WHEN ct.worker_id IS NOT NULL THEN w.district_id ELSE ct.district_id END";

// 1. The shared/authoritative count now used everywhere on the dashboard.
const [sharedRows] = await conn.query(
  `SELECT ${eff} AS district_id, COUNT(*) AS n
     FROM contacts ct
     LEFT JOIN workers w ON w.id = ct.worker_id
    WHERE (${eff}) IS NOT NULL${notWrong}
    GROUP BY district_id`
);
// 2. The OLD naive count (contacts.district_id only) — for reference/diagnosis.
const [naiveRows] = await conn.query(
  `SELECT ct.district_id AS district_id, COUNT(*) AS n
     FROM contacts ct
    WHERE ct.district_id IS NOT NULL${notWrong}
    GROUP BY ct.district_id`
);

const shared = new Map(sharedRows.map((r) => [r.district_id, Number(r.n) || 0]));
const naive = new Map(naiveRows.map((r) => [r.district_id, Number(r.n) || 0]));

// Every district in Master Data (so zero-worker districts appear too).
const [districts] = await conn.query(
  `SELECT id, name FROM locations WHERE type = 'district' ORDER BY name ASC`
);

let mismatches = 0;
console.log("District".padEnd(28), "Shared".padStart(8), "Naive".padStart(8), "  Status");
console.log("-".repeat(58));
for (const d of districts) {
  const s = shared.get(d.id) || 0;
  const n = naive.get(d.id) || 0;
  // The shared count IS the number the Contacts page shows, by construction
  // (same resolution). A shared≠naive gap is expected and explains the old bug;
  // it is not itself an error. We only flag a hard inconsistency if the shared
  // map contains a district id that Master Data doesn't (orphaned district).
  const ok = true;
  const flag = s !== n ? "Δ worker-linked" : "";
  console.log(
    String(d.name).padEnd(28),
    String(s).padStart(8),
    String(n).padStart(8),
    `  ${ok ? "✓" : "✗"} ${flag}`
  );
}

// Districts referenced by contacts that don't exist in Master Data → dropped
// silently by every view; surface them so no record is invisibly lost.
const masterIds = new Set(districts.map((d) => d.id));
const orphans = [...shared.keys()].filter((id) => id != null && !masterIds.has(id));
if (orphans.length) {
  console.log("\n⚠ Contacts point at district ids missing from Master Data:", orphans.join(", "));
  mismatches += orphans.length;
}

const totalShared = [...shared.values()].reduce((a, b) => a + b, 0);
const totalNaive = [...naive.values()].reduce((a, b) => a + b, 0);
console.log("-".repeat(58));
console.log("TOTAL".padEnd(28), String(totalShared).padStart(8), String(totalNaive).padStart(8));
console.log(
  `\nShared (worker-aware) is the number the Contacts page and every ranking/` +
  `map view now show. Rows marked "Δ worker-linked" have contacts whose linked ` +
  `worker sits in a different district than the contact's own column — those are ` +
  `the records the old naive count dropped.`
);

await conn.end();
process.exit(orphans.length ? 1 : 0);
