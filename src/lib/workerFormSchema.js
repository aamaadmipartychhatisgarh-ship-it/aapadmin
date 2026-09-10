import { query } from "@/lib/db";

// Tables for the Worker Form OTP flow. The registry is the existing `workers`
// table (not duplicated here) — these tables only hold OTP challenges and form
// submissions. Idempotent + cached per process.
let ensured = false;

export async function ensureWorkerFormSchema() {
  if (ensured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS worker_form_otps (
         id INT AUTO_INCREMENT PRIMARY KEY,
         phone VARCHAR(20) NOT NULL,          -- normalized last-10-digit key
         worker_id INT NULL,                  -- the registered worker this OTP is for
         otp_hash VARCHAR(128) NOT NULL,      -- keyed hash; never plaintext
         attempts INT NOT NULL DEFAULT 0,
         expires_at DATETIME NOT NULL,
         consumed_at DATETIME NULL,           -- single-use marker
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         KEY idx_wfo_phone (phone),
         KEY idx_wfo_created (created_at)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    // Isolate the two OTP flows that share this table: the /worker-form OTP
    // (scope 'worker_form', default) and the reg-link handler OTP (scope
    // 'reg_link', bound to the link token via ref_token). Guarded ALTERs — the
    // LIKE-free column check works on MariaDB's prepared protocol.
    await ensureColumn("worker_form_otps", "scope", "VARCHAR(20) NOT NULL DEFAULT 'worker_form'");
    await ensureColumn("worker_form_otps", "ref_token", "VARCHAR(64) NULL");

    await query(
      `CREATE TABLE IF NOT EXISTS worker_form_submissions (
         id INT AUTO_INCREMENT PRIMARY KEY,
         worker_id INT NOT NULL,              -- verified registered worker (from session)
         worker_name VARCHAR(255) NULL,       -- snapshot from workers at submit time
         phone VARCHAR(20) NOT NULL,          -- verified phone (from session/workers)
         form_data TEXT NULL,                 -- JSON of the editable fields
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         KEY idx_wfs_worker (worker_id),
         KEY idx_wfs_created (created_at)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    ensured = true;
  } catch (e) {
    console.error("[worker-form] ensure schema:", e?.message || e);
  }
}

// Add a column only if it does not already exist. Lists columns and filters in
// JS (no LIKE placeholder, which MariaDB's prepared protocol rejects).
async function ensureColumn(table, column, definition) {
  try {
    const rows = await query(`SHOW COLUMNS FROM \`${table}\``);
    if (!rows.some((r) => r.Field === column)) {
      await query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    }
  } catch (e) {
    console.error(`[worker-form] ensureColumn ${table}.${column}:`, e?.message || e);
  }
}
