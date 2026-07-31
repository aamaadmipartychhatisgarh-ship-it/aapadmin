// Adds indexes on the columns the Universal Reports Engine filters/sorts on the
// most, so reports stay fast as tables grow. Idempotent: skips any index that
// already exists. Run:  node --env-file=.env.local scripts/add-report-indexes.mjs
import { query } from "../src/lib/db.js";

// [table, indexName, columns...]
const INDEXES = [
  ["calls", "idx_calls_called_at", "called_at"],
  ["calls", "idx_calls_status", "status_id"],
  ["calls", "idx_calls_user", "user_id"],
  ["calls", "idx_calls_district", "district_id"],
  ["calls", "idx_calls_assembly", "assembly_id"],
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
  const rows = await query(
    `SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [table, name]
  );
  return rows.length > 0;
}

let added = 0, skipped = 0, failed = 0;
for (const [table, name, ...cols] of INDEXES) {
  try {
    if (await indexExists(table, name)) { skipped++; continue; }
    await query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${cols.map((c) => `\`${c}\``).join(",")})`);
    console.log(`+ ${table}.${name} (${cols.join(",")})`);
    added++;
  } catch (e) {
    console.error(`! ${table}.${name}: ${e.message}`);
    failed++;
  }
}
console.log(`\nDone. added=${added} skipped=${skipped} failed=${failed}`);
process.exit(0);
