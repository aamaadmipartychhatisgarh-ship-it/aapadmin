// Adds indexes on the columns the dashboard/report queries filter & sort on the
// most, so they use index-range scans instead of full table scans — the cause of
// the ~60s / 504 Gateway Timeouts on /api/reports, /api/tasks, /api/users, etc.
//
// Uses a DIRECT connection with NO per-statement time limit: ALTER TABLE ADD
// INDEX on a large table can take longer than the app's 15s statement cap, which
// silently killed the DDL before (why the indexes never got created). Idempotent
// — checks information_schema and skips any index that already exists; each ALTER
// is best-effort, so a table that doesn't exist in this deployment is skipped.
//
// Run:  node scripts/add-report-indexes.mjs
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const c = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});
// No statement timeout for the DDL (best-effort on either engine).
for (const sql of ["SET SESSION max_statement_time=0", "SET SESSION max_execution_time=0"]) {
  try { await c.query(sql); } catch { /* var name differs across MySQL/MariaDB */ }
}

// [table, indexName, columns…]
const INDEXES = [
  ["calls", "idx_calls_called_at", "called_at"],
  ["calls", "idx_calls_status", "status_id"],
  ["calls", "idx_calls_user", "user_id"],
  ["calls", "idx_calls_district", "district_id"],
  ["calls", "idx_calls_assembly", "assembly_id"],
  ["calls", "idx_calls_contact", "contact_id"],
  ["contacts", "idx_contacts_created", "created_at"],
  ["contacts", "idx_contacts_assignee", "assigned_to_user_id"],
  ["contacts", "idx_contacts_district", "district_id"],
  ["contacts", "idx_contacts_assembly", "assembly_id"],
  ["contacts", "idx_contacts_flags", "is_completed"],
  ["workers", "idx_workers_created", "created_at"],
  ["workers", "idx_workers_district", "district_id"],
  ["workers", "idx_workers_assembly", "assembly_id"],
  ["workers", "idx_workers_status", "status"],
  ["workers", "idx_workers_membership", "membership_status"],
  ["tasks", "idx_tasks_created", "created_at"],
  ["tasks", "idx_tasks_status", "status"],
  ["tasks", "idx_tasks_assignee", "assigned_to_user_id"],
  ["tasks", "idx_tasks_district", "district_id"],
  ["complaints", "idx_complaints_created", "created_at"],
  ["complaints", "idx_complaints_status", "status"],
  ["complaints", "idx_complaints_district", "district_id"],
  ["attendance_log", "idx_attendance_login", "login_at"],
  ["attendance_log", "idx_attendance_user", "user_id"],
  ["notifications", "idx_notifications_created", "created_at"],
  ["notifications", "idx_notifications_user", "user_id"],
  ["audit_logs", "idx_audit_created", "created_at"],
];

async function indexExists(table, name) {
  const [rows] = await c.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, name]
  );
  return rows.length > 0;
}

let added = 0, skipped = 0, failed = 0;
try {
  for (const [table, name, ...cols] of INDEXES) {
    try {
      if (await indexExists(table, name)) { skipped++; continue; }
      await c.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${cols.map((x) => `\`${x}\``).join(",")})`);
      console.log(`+ ${table}.${name} (${cols.join(",")})`);
      added++;
    } catch (e) {
      console.error(`! ${table}.${name}: ${e.message}`);
      failed++;
    }
  }
  console.log(`Done. added=${added} skipped=${skipped} failed=${failed}`);
} finally {
  await c.end();
}
