import { getPool } from "@/lib/db";

// Indexes the Reports queries rely on: the module date columns are both the
// range filter AND the ORDER BY ... LIMIT sort, so a single index on each makes
// those queries index-range scans instead of full table scans (the cause of the
// 60s/504 timeouts). Only columns that are NOT already covered by a FK index.
const WANT = [
  { table: "calls", name: "idx_calls_called_at", cols: "called_at" },
  { table: "contacts", name: "idx_contacts_created_at", cols: "created_at" },
];

let started = false;

// Add a single missing index on a DEDICATED connection: DDL can take longer than
// the pool's per-statement cap, so lift it on this connection only, then DESTROY
// the connection (never return the un-capped connection to the pool). Idempotent
// via information_schema; best-effort (never throws).
async function addIndexIfMissing(pool, idx) {
  let conn;
  try {
    conn = await pool.getConnection();
    try { await conn.query("SET SESSION max_statement_time=0"); } catch { /* MySQL uses a different var */ }
    try { await conn.query("SET SESSION max_execution_time=0"); } catch { /* MariaDB uses a different var */ }
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [idx.table, idx.name]
    );
    if (Number(rows?.[0]?.n || 0) === 0) {
      // Online DDL: InnoDB keeps the table readable/writable while this builds.
      await conn.query(`ALTER TABLE \`${idx.table}\` ADD INDEX \`${idx.name}\` (${idx.cols})`);
      console.log(`[reports] created index ${idx.name} on ${idx.table}(${idx.cols})`);
    }
  } catch (e) {
    console.error("[reports] ensureReportIndexes", idx.name, e?.code || e?.message);
  } finally {
    // Destroy (not release) so the timeout-lifted connection is not reused; the
    // pool transparently opens a fresh, properly-capped one on next demand.
    try { conn?.destroy(); } catch { /* ignore */ }
  }
}

// DISABLED BY DEFAULT for production safety. Running a heavy ALTER TABLE ADD
// INDEX from inside a web request can lock a large calls/contacts table and
// spike CPU/memory on shared hosting — a possible cause of an outage. Create the
// indexes during a maintenance window with:
//     node scripts/add-report-indexes.mjs
// (idempotent, no per-statement time cap). Only opt back into the automatic
// background create by setting REPORTS_AUTO_INDEX=1 once the host can handle it.
export function ensureReportIndexes() {
  if (process.env.REPORTS_AUTO_INDEX !== "1") return;
  if (started) return;
  started = true;
  const pool = getPool();
  for (const idx of WANT) {
    addIndexIfMissing(pool, idx); // intentionally not awaited
  }
}
