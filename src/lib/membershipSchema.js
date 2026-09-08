import { query } from "@/lib/db";

// Schema for the Super-Admin-only "Worker & Membership Management" module.
//
// This dashboard already carries the `workers` roster (identity + geography down
// to booth). What it did NOT have is the member-registration data the worker app
// produces — a table of members, each permanently linked to the worker who added
// them, plus campaign periods and per-member certificate / WhatsApp / SMS status.
// This module OWNS those new tables. They start empty and fill as the worker app
// writes member registrations into `members` (worker_id = the adder's workers.id).
//
// ensureMembershipSchema() is idempotent (CREATE TABLE IF NOT EXISTS + guarded
// ALTERs) and cached per process, so the hot read paths run no DDL.

let ensured = false;

export async function ensureMembershipSchema() {
  if (ensured) return;
  try {
    // The workers table is the source of truth for worker identity/geography. It
    // normally already exists (org module); create a compatible shell only if a
    // fresh DB is missing it, so this module is self-contained. IF NOT EXISTS
    // never clobbers the richer existing table.
    await query(
      `CREATE TABLE IF NOT EXISTS workers (
         id INT AUTO_INCREMENT PRIMARY KEY,
         name VARCHAR(255) NOT NULL,
         mobile VARCHAR(20) NULL,
         photo_url VARCHAR(512) NULL,
         address TEXT NULL,
         zone_id INT NULL,
         lok_sabha_id INT NULL,
         district_id INT NULL,
         assembly_id INT NULL,
         ward_id INT NULL,
         booth_id INT NULL,
         position VARCHAR(255) NULL,
         status VARCHAR(20) NOT NULL DEFAULT 'active',
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         KEY idx_workers_assembly (assembly_id),
         KEY idx_workers_ward (ward_id),
         KEY idx_workers_status (status)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // Permanent worker "User ID" (MUKH@4582 = first 4 letters of the name + @ +
    // digits derived from the immutable id). Added as a nullable column and
    // backfilled ONCE per row; never regenerated for a row that already has one,
    // so the User ID stays stable across the 3-month password cycles (§4, §24).
    await ensureColumn("workers", "worker_code", "VARCHAR(24) NULL");
    await ensureIndex("workers", "idx_workers_code", "worker_code");

    // Members — each row is a registered member, permanently referencing the
    // worker who added them (worker_id → workers.id, an internal ID, never a
    // name). `status` defines a "successful" member: only 'active' rows count
    // toward every statistic, so duplicates/rejects never inflate totals (§30).
    await query(
      `CREATE TABLE IF NOT EXISTS members (
         id INT AUTO_INCREMENT PRIMARY KEY,
         membership_id VARCHAR(40) NULL,
         name VARCHAR(200) NOT NULL,
         mobile VARCHAR(20) NULL,
         address TEXT NULL,
         photo_url VARCHAR(512) NULL,
         worker_id INT NULL,
         assembly_id INT NULL,
         ward_id INT NULL,
         booth_id INT NULL,
         campaign_id INT NULL,
         registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         status ENUM('active','duplicate','rejected') NOT NULL DEFAULT 'active',
         certificate_status ENUM('pending','generated','failed') NOT NULL DEFAULT 'pending',
         certificate_generated_at DATETIME NULL,
         whatsapp_status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
         sms_status ENUM('pending','sent','failed','not_required') NOT NULL DEFAULT 'pending',
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         KEY idx_members_worker (worker_id),
         KEY idx_members_assembly (assembly_id),
         KEY idx_members_ward (ward_id),
         KEY idx_members_booth (booth_id),
         KEY idx_members_registered (registered_at),
         KEY idx_members_status (status),
         KEY idx_members_campaign (campaign_id),
         KEY idx_members_mobile (mobile),
         KEY idx_members_membership (membership_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // Membership campaigns — the 3-month drive periods. Each carries the access
    // (password) cycle window it governs. Rotating to a new campaign issues a new
    // cycle without ever changing worker User IDs (§23, §24).
    await query(
      `CREATE TABLE IF NOT EXISTS membership_campaigns (
         id INT AUTO_INCREMENT PRIMARY KEY,
         name VARCHAR(120) NOT NULL,
         start_date DATE NOT NULL,
         end_date DATE NOT NULL,
         status ENUM('upcoming','active','closed') NOT NULL DEFAULT 'active',
         password_cycle_start DATE NULL,
         password_cycle_expiry DATE NULL,
         created_by INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         KEY idx_campaign_status (status)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // Backfill worker User IDs for any row that lacks one. Deterministic from the
    // immutable id → permanent and unique-per-(prefix,id). REGEXP_REPLACE/RPAD are
    // available on MySQL 8 and MariaDB 10.0.5+. Best-effort.
    try {
      await query(
        `UPDATE workers
            SET worker_code = CONCAT(
              UPPER(RPAD(LEFT(REGEXP_REPLACE(COALESCE(name,''), '[^A-Za-z]', ''), 4), 4, 'X')),
              '@',
              CASE WHEN id <= 9999 THEN LPAD(id, 4, '0') ELSE id END
            )
          WHERE worker_code IS NULL OR worker_code = ''`
      );
    } catch (e) {
      console.error("[membership] worker_code backfill:", e?.message || e);
    }

    ensured = true;
  } catch (e) {
    console.error("[membership] ensure schema:", e?.message || e);
  } finally {
    // Whatever happened, refresh the column cache so the adaptive query layer
    // sees the real, current shape of the tables (a failed ALTER must not leave
    // a stale "column exists" belief, and vice-versa).
    invalidateColumns();
  }
}

// --- Schema introspection (adaptive query layer) ---------------------------
//
// The `members` table may be OWNED by this module (the schema above) or may
// already exist from the worker app with a DIFFERENT shape (e.g. no per-member
// assembly_id/ward_id — geography derived from the worker instead). To never
// 500 on a missing column, the stats layer asks columnsOf() what actually
// exists and references only those columns. Cached per process; invalidated
// whenever ensureMembershipSchema() runs.
const colCache = new Map();
export async function columnsOf(table) {
  if (colCache.has(table)) return colCache.get(table);
  let set = new Set();
  try {
    const rows = await query(`SHOW COLUMNS FROM \`${table}\``);
    set = new Set(rows.map((r) => r.Field));
  } catch {
    // Table missing / unreadable → empty set; callers degrade gracefully.
  }
  colCache.set(table, set);
  return set;
}
export function invalidateColumns(table) {
  if (table) colCache.delete(table);
  else colCache.clear();
}

// Add a column only if it does not already exist (guarded ALTER).
async function ensureColumn(table, column, definition) {
  try {
    const rows = await query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
    if (!rows.length) await query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  } catch (e) {
    console.error(`[membership] ensureColumn ${table}.${column}:`, e?.message || e);
  }
}
// Add a non-unique index only if it does not already exist.
async function ensureIndex(table, indexName, columns) {
  try {
    const rows = await query(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, [indexName]);
    if (!rows.length) await query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${columns})`);
  } catch (e) {
    console.error(`[membership] ensureIndex ${table}.${indexName}:`, e?.message || e);
  }
}

// Only 'active' members are "successful" — the single consistent definition used
// by every count in this module.
export const SUCCESSFUL_MEMBER_STATUS = "active";

export const CERTIFICATE_STATUSES = ["pending", "generated", "failed"];
export const WHATSAPP_STATUSES = ["pending", "sent", "failed"];
export const SMS_STATUSES = ["pending", "sent", "failed", "not_required"];
export const WORKER_ACTIVE_STATUSES = ["active"]; // workers.status values treated as active

// Date-range presets → {from, to} (inclusive 'YYYY-MM-DD'), resolved server-side
// against the member registration timestamp. Custom uses explicit from/to.
export function resolvePeriod(preset, from, to) {
  const d = new Date();
  const iso = (x) => x.toISOString().slice(0, 10);
  const startOfWeek = (base) => { const x = new Date(base); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; };
  switch (preset) {
    case "today": return { from: iso(d), to: iso(d) };
    case "yesterday": { const y = new Date(d); y.setDate(y.getDate() - 1); return { from: iso(y), to: iso(y) }; }
    case "week": return { from: iso(startOfWeek(d)), to: iso(d) };
    case "month": return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(d) };
    case "custom": return { from: from || null, to: to || null };
    default: return { from: null, to: null }; // lifetime / campaign total
  }
}
