import { query, withConnection } from "@/lib/db";
import { userCanAccessPageKey, getUserGrantKeys } from "@/lib/pageAccess";
import { isSuperAdmin, isTopAdmin, roleOf, ROLES } from "@/lib/permissions";
import { ensureAuditSchema, logAudit } from "@/lib/audit";

// DESIGNATION APPROVAL SYSTEM — 8-stage sequential workflow.
//
// A designation is NOT final when it is assigned. It runs through eight stages,
// strictly in order, and only Prabhari Ji's approval at stage 8 makes it FINAL
// APPROVED and unlocks the certificate:
//
//   1 Vidhansabha Prabhari → 2 District President → 3 Lok Sabha President/Adhyaksh
//   → 4 Lok Sabha Prabhari → 5 Pradesh Sangathan Mantri → 6 Pradesh Karyakari
//   Adhyaksh → 7 Sah Prabhari → 8 Prabhari Ji (Super Admin)
//
// Everything is enforced HERE, on the server: the stage order, who may act at the
// current stage, which location they are responsible for, duplicate/concurrent
// requests and certificate eligibility. The UI is only a mirror of these rules.
//
// Who an approver is is never hard-coded (no names / user ids): a stage is gated by
// a Page-Access grant (granted by a Super Admin) AND — for the location-bound
// stages — by the approver's own organisational location (their user scope, else
// their linked Contact's location) matching the designation's Assembly / District /
// Lok Sabha. Prabhari Ji is the authenticated Super Admin role, never a name.
//
// Data model (reuses the existing tables; nothing is duplicated):
//   designation_assignments      one row per assignment (status, current stage,
//                                snapshot of member/designation/location, final
//                                approval + certificate metadata)
//   designation_approvals        one row per (assignment, stage) — the live state
//   designation_approval_history APPEND-ONLY audit trail of every action

// The mandatory order. `key` is the Page-Access grant needed to act at that stage —
// kept stable across the 7→8 change so existing grants keep working (stage 2's key
// is still approve_l1_district_president, etc.). `scope` is the location level the
// approver must be responsible for (null = state-level). `superOnly` stages need
// the Super Admin role itself.
export const APPROVAL_LEVELS = [
  { level: 1, label: "Vidhansabha Prabhari", key: "approve_s1_vidhansabha_prabhari", scope: "assembly" },
  { level: 2, label: "District President", key: "approve_l1_district_president", scope: "district" },
  { level: 3, label: "Lok Sabha President / Adhyaksh", key: "approve_l2_loksabha_adhyaksh", scope: "lok_sabha" },
  { level: 4, label: "Lok Sabha Prabhari", key: "approve_l3_loksabha_prabhari", scope: "lok_sabha" },
  { level: 5, label: "Pradesh Sangathan Mantri", key: "approve_l4_sangathan_mantri", scope: null },
  { level: 6, label: "Pradesh Karyakari Adhyaksh", key: "approve_l5_karyakari_adhyaksh", scope: null },
  { level: 7, label: "Sah Prabhari", key: "approve_l6_sah_prabhari", scope: null },
  { level: 8, label: "Prabhari Ji (Super Admin)", key: "approve_l7_prabhari_ji", scope: null, superOnly: true },
];
export const TOTAL_LEVELS = APPROVAL_LEVELS.length; // 8
export const levelConfig = (n) => APPROVAL_LEVELS.find((l) => l.level === Number(n)) || null;
// The Page-Access key needed to INITIATE a designation from the Approval page.
export const INITIATE_KEY = "approval_initiate";
// The page key for opening the Designation Approval page.
export const APPROVALS_PAGE_KEY = "approvals";

const SCOPE_LABEL = { assembly: "Assembly", district: "District", lok_sabha: "Lok Sabha" };
const DONE = ["approved", "legacy"]; // a stage that counts as satisfied

// ---------------------------------------------------------------------------
// Schema + one-time migration
// ---------------------------------------------------------------------------

async function colExists(table, col) {
  const r = await query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
    [table, col]
  );
  return r.length > 0;
}
async function addColumn(table, col, ddl) {
  if (await colExists(table, col)) return;
  try { await query(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`); }
  catch (e) { if (!/duplicate column/i.test(e?.message || "")) throw e; }
}
async function addUniqueIndex(table, name, cols) {
  const r = await query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1",
    [table, name]
  );
  if (r.length) return;
  try { await query(`ALTER TABLE ${table} ADD UNIQUE KEY ${name} (${cols})`); }
  catch (e) { if (!/duplicate key name/i.test(e?.message || "")) throw e; }
}

let ensuredPromise = null;
export function ensureApprovalSchema() {
  // Memoise the in-flight promise so concurrent first requests run the schema +
  // migration once. A FAILURE is not cached (so the next request retries) and is
  // rethrown — a migration error must never be swallowed.
  if (!ensuredPromise) {
    ensuredPromise = doEnsure().catch((e) => {
      ensuredPromise = null;
      console.error("[approvals] ensureApprovalSchema failed:", e?.message || e);
      throw e;
    });
  }
  return ensuredPromise;
}

async function doEnsure() {
  await query(
    `CREATE TABLE IF NOT EXISTS designation_assignments (
       id INT AUTO_INCREMENT PRIMARY KEY,
       member_id INT NULL,
       member_name VARCHAR(255) NULL,
       member_phone VARCHAR(30) NULL,
       member_photo_url VARCHAR(512) NULL,
       designation_id INT NULL,
       designation_name VARCHAR(255) NULL,
       assembly_id INT NULL, assembly_name VARCHAR(160) NULL,
       district_id INT NULL, district_name VARCHAR(160) NULL,
       lok_sabha_id INT NULL, lok_sabha_name VARCHAR(160) NULL,
       zone_id INT NULL, zone_name VARCHAR(160) NULL,
       assigned_by_user_id INT NULL,
       assigned_by_name VARCHAR(160) NULL,
       status VARCHAR(30) NOT NULL DEFAULT 'pending',
       current_level INT NOT NULL DEFAULT 1,
       rejected_by_user_id INT NULL,
       rejected_reason TEXT NULL,
       rejected_at TIMESTAMP NULL,
       final_approved_at TIMESTAMP NULL,
       certificate_status VARCHAR(30) NOT NULL DEFAULT 'not_available',
       certificate_number VARCHAR(64) NULL,
       certificate_issued_by_user_id INT NULL,
       certificate_issued_at TIMESTAMP NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       KEY idx_da_status (status),
       KEY idx_da_level (current_level),
       KEY idx_da_member (member_id),
       KEY idx_da_assigned_by (assigned_by_user_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  await query(
    `CREATE TABLE IF NOT EXISTS designation_approvals (
       id INT AUTO_INCREMENT PRIMARY KEY,
       assignment_id INT NOT NULL,
       approval_level INT NOT NULL,
       required_role VARCHAR(120) NOT NULL,
       required_key VARCHAR(80) NOT NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'locked',
       approver_user_id INT NULL,
       approver_name VARCHAR(160) NULL,
       approver_role VARCHAR(120) NULL,
       signature VARCHAR(255) NULL,
       remarks TEXT NULL,
       ip VARCHAR(64) NULL,
       approved_at TIMESTAMP NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uq_assignment_level (assignment_id, approval_level),
       KEY idx_ap_assignment (assignment_id),
       KEY idx_ap_approver (approver_user_id),
       KEY idx_ap_status (status)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  // APPEND-ONLY audit trail: one row per action, never updated or deleted by the app.
  // approver_name is a snapshot and actor_user_id a stable reference, so history stays
  // correct if the person is renamed or changes role later.
  await query(
    `CREATE TABLE IF NOT EXISTS designation_approval_history (
       id INT AUTO_INCREMENT PRIMARY KEY,
       assignment_id INT NOT NULL,
       cycle INT NOT NULL DEFAULT 1,
       stage INT NULL,
       action VARCHAR(30) NOT NULL,
       actor_user_id INT NULL,
       actor_name VARCHAR(160) NULL,
       actor_role VARCHAR(160) NULL,
       previous_status VARCHAR(30) NULL,
       new_status VARCHAR(30) NULL,
       remarks TEXT NULL,
       ip VARCHAR(64) NULL,
       action_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       KEY idx_dah_assignment (assignment_id),
       KEY idx_dah_actor (actor_user_id),
       KEY idx_dah_action (action)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  // Columns added for the 8-stage workflow + registration link (additive only).
  await addColumn("designation_assignments", "workflow_version", "INT NOT NULL DEFAULT 1");
  await addColumn("designation_assignments", "cycle", "INT NOT NULL DEFAULT 1");
  await addColumn("designation_assignments", "registration_type", "VARCHAR(20) NULL");
  await addColumn("designation_assignments", "registration_id", "INT NULL");
  await addColumn("designation_assignments", "block_id", "INT NULL");
  await addColumn("designation_assignments", "block_name", "VARCHAR(160) NULL");
  await addColumn("designation_assignments", "submitted_by_reg_worker_id", "INT NULL");
  await addColumn("designation_assignments", "submitted_by_designation", "VARCHAR(160) NULL");
  await addColumn("designation_assignments", "final_approved_by_user_id", "INT NULL");
  await addColumn("designation_assignments", "final_approved_by_name", "VARCHAR(160) NULL");
  await addColumn("designation_assignments", "returned_by_user_id", "INT NULL");
  await addColumn("designation_assignments", "returned_reason", "TEXT NULL");
  await addColumn("designation_assignments", "returned_at", "TIMESTAMP NULL");
  await addColumn("designation_assignments", "certificate_issued_by_name", "VARCHAR(160) NULL");
  // One approval workflow per (registration, designation): the DB itself refuses a
  // duplicate when a registration is retried. Rows with no registration (NULLs) never
  // collide.
  await addUniqueIndex("designation_assignments", "uq_da_registration", "registration_type, registration_id, designation_id");

  await migrateToEightStages();
}

// 7→8 migration. Existing assignments were created under the old 7-stage chain, so
// each is shifted by one (their old stage N is now stage N+1) and given an explicit
// 'legacy' stage 1. 'legacy' is NOT 'approved': it records that the assignment
// pre-dates the Vidhansabha Prabhari stage and was carried over, so no approval is
// ever fabricated. It still counts as satisfied for sequencing and the certificate
// gate, so assignments already in flight (or already final) keep working.
// Per-assignment transaction + a row lock on workflow_version makes it idempotent
// and safe if two server processes start together.
async function migrateToEightStages() {
  const todo = await query("SELECT id FROM designation_assignments WHERE workflow_version = 1");
  const s1 = APPROVAL_LEVELS[0];
  for (const { id } of todo) {
    // eslint-disable-next-line no-await-in-loop
    await withConnection(async (conn) => {
      await conn.beginTransaction();
      try {
        const [[a]] = await conn.query(
          "SELECT id, workflow_version, status, assigned_by_user_id, assigned_by_name, created_at, final_approved_at FROM designation_assignments WHERE id = ? FOR UPDATE",
          [id]
        );
        if (!a || a.workflow_version !== 1) { await conn.rollback(); return; }
        // Descending so (assignment_id, approval_level) never collides mid-update.
        await conn.query("UPDATE designation_approvals SET approval_level = approval_level + 1 WHERE assignment_id = ? ORDER BY approval_level DESC", [id]);
        await conn.query(
          `INSERT INTO designation_approvals (assignment_id, approval_level, required_role, required_key, status, remarks)
           VALUES (?, 1, ?, ?, 'legacy', ?)`,
          [id, s1.label, s1.key, "Created before the Vidhansabha Prabhari stage existed — carried over, not re-approved."]
        );
        await conn.query("UPDATE designation_assignments SET current_level = current_level + 1, workflow_version = 2 WHERE id = ?", [id]);

        // Back-fill the audit trail from what the old model recorded, so history is
        // complete for legacy assignments and "Processed by Me" still finds them.
        await conn.query(
          `INSERT INTO designation_approval_history (assignment_id, cycle, stage, action, actor_user_id, actor_name, new_status, remarks, action_at)
           VALUES (?, 1, NULL, 'submitted', ?, ?, 'pending', 'Back-filled from the pre-history record.', ?)`,
          [id, a.assigned_by_user_id ?? null, a.assigned_by_name ?? null, a.created_at]
        );
        const [rows] = await conn.query(
          "SELECT approval_level, status, approver_user_id, approver_name, approver_role, remarks, approved_at FROM designation_approvals WHERE assignment_id = ? AND status IN ('approved','rejected') ORDER BY approval_level",
          [id]
        );
        for (const r of rows) {
          // eslint-disable-next-line no-await-in-loop
          await conn.query(
            `INSERT INTO designation_approval_history (assignment_id, cycle, stage, action, actor_user_id, actor_name, actor_role, previous_status, new_status, remarks, action_at)
             VALUES (?, 1, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
            [id, r.approval_level, r.status === "approved" ? (r.approval_level === TOTAL_LEVELS ? "final_approved" : "approved") : "rejected",
             r.approver_user_id ?? null, r.approver_name ?? null, r.approver_role ?? null, r.status, r.remarks ?? "Back-filled from the pre-history record.", r.approved_at]
          );
        }
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      }
    });
  }
}

function ipOf(req) {
  try {
    const h = req?.headers;
    return (h?.get("x-forwarded-for")?.split(",")[0]?.trim()) || h?.get("x-real-ip") || null;
  } catch { return null; }
}
const actorName = (session) => session?.user?.name || session?.user?.username || null;

// ---------------------------------------------------------------------------
// Organisational location of a user (for location-bound stages)
// ---------------------------------------------------------------------------

let _hasContactCol = null;
async function usersHaveContactId() {
  if (_hasContactCol === null) _hasContactCol = await colExists("users", "contact_id");
  return _hasContactCol;
}

// Walk locations upward (assembly → district → Lok Sabha → zone) from the most
// specific id known, then fall back to any explicit ids for types the walk missed.
async function locationChain(run, ids) {
  const out = { assembly: null, district: null, lok_sabha: null, zone: null };
  const get = async (id) => (await run("SELECT id, name, type, parent_id FROM locations WHERE id = ? LIMIT 1", [id]))[0] || null;
  let cur = ids.assembly_id || ids.district_id || ids.lok_sabha_id || ids.zone_id || null;
  for (let i = 0; i < 6 && cur; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const row = await get(cur);
    if (!row) break;
    if (out[row.type] === null && row.type in out) out[row.type] = { id: row.id, name: row.name };
    cur = row.parent_id;
  }
  for (const [t, id] of [["assembly", ids.assembly_id], ["district", ids.district_id], ["lok_sabha", ids.lok_sabha_id], ["zone", ids.zone_id]]) {
    if (!out[t] && id) {
      // eslint-disable-next-line no-await-in-loop
      const row = await get(id);
      if (row) out[t] = { id: row.id, name: row.name };
    }
  }
  return out;
}

// Assembly → district → Lok Sabha → zone for an assembly id, in the shape
// createAssignmentTx expects. `run(sql, params)` must return the rows.
export async function buildLocationFromAssembly(run, assemblyId) {
  const chain = await locationChain(run, { assembly_id: assemblyId });
  return { assembly: chain.assembly, district: chain.district, lokSabha: chain.lok_sabha, zone: chain.zone };
}

// The location a user is responsible for: their explicit user scope first, else
// their linked Contact's location — the existing organisational assignments.
async function approverProfile(userId) {
  const empty = { assembly_id: null, district_id: null, lok_sabha_id: null, zone_id: null };
  if (!userId) return empty;
  const withContact = await usersHaveContactId();
  const rows = await query(
    withContact
      ? `SELECT u.scope_assembly_id, u.home_district_id, u.scope_lok_sabha_id, u.scope_zone_id,
                c.assembly_id AS c_a, c.district_id AS c_d, c.lok_sabha_id AS c_ls, c.zone_id AS c_z
           FROM users u LEFT JOIN contacts c ON c.id = u.contact_id WHERE u.id = ? LIMIT 1`
      : `SELECT scope_assembly_id, home_district_id, scope_lok_sabha_id, scope_zone_id,
                NULL AS c_a, NULL AS c_d, NULL AS c_ls, NULL AS c_z FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const u = rows[0];
  if (!u) return empty;
  const chain = await locationChain(query, {
    assembly_id: u.scope_assembly_id || u.c_a || null,
    district_id: u.home_district_id || u.c_d || null,
    lok_sabha_id: u.scope_lok_sabha_id || u.c_ls || null,
    zone_id: u.scope_zone_id || u.c_z || null,
  });
  return {
    assembly_id: chain.assembly?.id ?? null,
    district_id: chain.district?.id ?? null,
    lok_sabha_id: chain.lok_sabha?.id ?? null,
    zone_id: chain.zone?.id ?? null,
  };
}

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// Does a holder of `cfg`'s grant, located at `profile`, cover this assignment?
function scopeCovers(cfg, profile, a) {
  if (!cfg.scope) return true;
  return sameId(profile[`${cfg.scope}_id`], a[`${cfg.scope}_id`]);
}

// Everything the server needs to decide what THIS user may see and do, resolved
// from the authenticated session + DB — never from the client.
async function buildAccess(session) {
  const uid = session?.user?.id ?? null;
  const superAdmin = isSuperAdmin(session);
  const grants = uid ? await getUserGrantKeys(uid) : new Set();
  const profile = await approverProfile(uid);
  const levels = APPROVAL_LEVELS.filter((l) => (l.superOnly ? superAdmin : grants.has(l.key))).map((l) => l.level);
  const role = roleOf(session);
  const fullView = isTopAdmin(session); // Super Admin / State Admin
  const territoryAdmin = [ROLES.ZONE_ADMIN, ROLES.DISTRICT_ADMIN, ROLES.ASSEMBLY_ADMIN].includes(role);

  // May this user act at stage `lvl` on assignment `a` (ignoring status)?
  const holdsStage = (a, lvl) => {
    const cfg = levelConfig(lvl);
    if (!cfg) return false;
    if (cfg.superOnly) return superAdmin;
    if (!grants.has(cfg.key)) return false;
    return scopeCovers(cfg, profile, a);
  };
  const inTerritory = (a) => territoryAdmin && (
    sameId(profile.assembly_id, a.assembly_id) || sameId(profile.district_id, a.district_id) ||
    sameId(profile.lok_sabha_id, a.lok_sabha_id) || sameId(profile.zone_id, a.zone_id)
  );
  return {
    uid, superAdmin, fullView, grants, profile, levels, holdsStage,
    // May act on the assignment's CURRENT stage right now (pending only; never on
    // your own submission, except Prabhari Ji's final stage).
    canActNow: (a) => a.status === "pending" && holdsStage(a, a.current_level) &&
      !(sameId(a.assigned_by_user_id, uid) && !superAdmin),
    // May this user see the record at all (never granted by knowing its id).
    canSee: (a) => fullView || sameId(a.assigned_by_user_id, uid) || inTerritory(a) ||
      APPROVAL_LEVELS.some((l) => holdsStage(a, l.level)),
  };
}

export async function userApprovalLevels(session) {
  return (await buildAccess(session)).levels;
}
export async function approvalAccess(session) { return buildAccess(session); }

// The users who could act at `level` for this assignment (grant + location match;
// Prabhari Ji = Super Admins). An empty list means NO approver is mapped — the
// record stays pending (never skipped or auto-approved) and an admin is warned.
export async function eligibleApprovers(level, a) {
  const cfg = levelConfig(level);
  if (!cfg) return [];
  if (cfg.superOnly) {
    return query("SELECT id AS user_id, username FROM users WHERE role IN (?, ?)", [ROLES.SUPER_ADMIN, "admin"]);
  }
  // page_permissions is created lazily by the Page-Access module; if it does not
  // exist yet nobody holds any grant, so no approver is mapped.
  const holders = await query(
    "SELECT DISTINCT u.id AS user_id, u.username FROM page_permissions pp JOIN users u ON u.id = pp.user_id WHERE pp.page_key = ?",
    [cfg.key]
  ).catch((e) => {
    if (/doesn't exist|ER_NO_SUCH_TABLE/i.test(e?.message || e?.code || "")) return [];
    throw e;
  });
  if (!cfg.scope) return holders;
  const out = [];
  for (const h of holders) {
    // eslint-disable-next-line no-await-in-loop
    const p = await approverProfile(h.user_id);
    if (scopeCovers(cfg, p, a)) out.push(h);
  }
  return out;
}

// ---------------------------------------------------------------------------
// History + notifications helpers
// ---------------------------------------------------------------------------

async function addHistory(conn, h) {
  await conn.query(
    `INSERT INTO designation_approval_history
       (assignment_id, cycle, stage, action, actor_user_id, actor_name, actor_role, previous_status, new_status, remarks, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [h.assignmentId, h.cycle ?? 1, h.stage ?? null, h.action, h.actorUserId ?? null, h.actorName ?? null,
     h.actorRole ?? null, h.previous ?? null, h.next ?? null, h.remarks ?? null, h.ip ?? null]
  );
}

async function notifyUsers(userIds, { type, title, body }) {
  try {
    for (const uid of userIds) {
      // eslint-disable-next-line no-await-in-loop
      await query(
        `INSERT INTO notifications (user_id, type, severity, title, body, link, is_read) VALUES (?, ?, 'info', ?, ?, ?, 0)`,
        [uid, type, title, body, "/dashboard/admin/approvals"]
      ).catch(() => {});
    }
  } catch { /* notifications are best-effort */ }
}
async function notifyStage(assignmentId, level, message) {
  try {
    const a = await getAssignment(assignmentId);
    if (!a) return;
    const cfg = levelConfig(level);
    const who = await eligibleApprovers(level, a);
    await notifyUsers(who.map((w) => w.user_id), { type: "approval_pending", title: `Approval pending — ${cfg.label}`, body: message });
  } catch { /* optional */ }
}
async function notifySubmitter(assignmentId, message) {
  try {
    const [a] = await query("SELECT assigned_by_user_id FROM designation_assignments WHERE id = ?", [assignmentId]);
    if (a?.assigned_by_user_id) await notifyUsers([a.assigned_by_user_id], { type: "approval_update", title: "Designation approval update", body: message });
  } catch { /* optional */ }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

// Create an assignment + its 8 stage rows + the 'submitted' history entry using the
// caller's connection/transaction, so a registration and its approval record are
// saved atomically (a registration with a designation can never end up outside the
// workflow, and a failure rolls both back). Idempotent: a retry for the same
// registration+designation (or the same pending member+designation) returns the
// existing workflow instead of creating a second one.
export async function createAssignmentTx(conn, d) {
  const isReg = !!(d.registrationType && d.registrationId);
  const lockName = isReg ? null : `da:${d.memberId || 0}:${d.designationId}`;
  if (lockName) await conn.query("SELECT GET_LOCK(?, 10)", [lockName]);
  try {
    if (isReg) {
      const [[ex]] = await conn.query(
        "SELECT id FROM designation_assignments WHERE registration_type = ? AND registration_id = ? AND designation_id = ? LIMIT 1 FOR UPDATE",
        [d.registrationType, d.registrationId, d.designationId]
      );
      if (ex) return { id: ex.id, existing: true };
    } else if (d.memberId) {
      const [[ex]] = await conn.query(
        "SELECT id FROM designation_assignments WHERE member_id = ? AND designation_id = ? AND status IN ('pending','returned') LIMIT 1",
        [d.memberId, d.designationId]
      );
      if (ex) return { id: ex.id, existing: true };
    }
    let res;
    try {
      [res] = await conn.query(
        `INSERT INTO designation_assignments
           (member_id, member_name, member_phone, member_photo_url, designation_id, designation_name,
            assembly_id, assembly_name, district_id, district_name, lok_sabha_id, lok_sabha_name,
            zone_id, zone_name, block_id, block_name, assigned_by_user_id, assigned_by_name,
            submitted_by_reg_worker_id, submitted_by_designation, registration_type, registration_id,
            status, current_level, workflow_version, cycle)
         VALUES (?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?, 'pending', 1, 2, 1)`,
        [d.memberId ?? null, d.memberName ?? null, d.memberPhone ?? null, d.memberPhotoUrl ?? null, d.designationId, d.designationName ?? null,
         d.assembly?.id ?? null, d.assembly?.name ?? null, d.district?.id ?? null, d.district?.name ?? null,
         d.lokSabha?.id ?? null, d.lokSabha?.name ?? null, d.zone?.id ?? null, d.zone?.name ?? null,
         d.block?.id ?? null, d.block?.name ?? null, d.assignedByUserId ?? null, d.assignedByName ?? null,
         d.submittedByRegWorkerId ?? null, d.submittedByDesignation ?? null, d.registrationType ?? null, d.registrationId ?? null]
      );
    } catch (e) {
      // A concurrent identical request won the unique index — return ITS workflow.
      if (isReg && e?.code === "ER_DUP_ENTRY") {
        const [[ex]] = await conn.query(
          "SELECT id FROM designation_assignments WHERE registration_type = ? AND registration_id = ? AND designation_id = ? LIMIT 1",
          [d.registrationType, d.registrationId, d.designationId]
        );
        if (ex) return { id: ex.id, existing: true };
      }
      throw e;
    }
    const id = res.insertId;
    const values = APPROVAL_LEVELS.map((l) => [id, l.level, l.label, l.key, l.level === 1 ? "pending" : "locked"]);
    await conn.query("INSERT INTO designation_approvals (assignment_id, approval_level, required_role, required_key, status) VALUES ?", [values]);
    await addHistory(conn, {
      assignmentId: id, cycle: 1, stage: 1, action: "submitted",
      actorUserId: d.assignedByUserId, actorName: d.assignedByName, actorRole: d.submittedByDesignation || null,
      previous: null, next: "pending",
      remarks: isReg ? `Submitted from a ${d.registrationType} registration.` : "Initiated from the Designation Approval page.",
      ip: d.ip || null,
    });
    return { id, existing: false };
  } finally {
    if (lockName) await conn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
  }
}

// After-commit side effects for a brand-new assignment (audit + notify stage 1).
export async function afterAssignmentCreated(session, assignmentId, summary) {
  try {
    await ensureAuditSchema();
    logAudit(session || null, { action: "designation.approval.created", entityType: "designation_assignment", entityId: assignmentId, details: summary || null });
  } catch { /* audit is best-effort */ }
  notifyStage(assignmentId, 1, `New designation awaiting your approval${summary?.designation ? `: ${summary.designation}` : ""}${summary?.member ? ` — ${summary.member}` : ""}`).catch(() => {});
}

// A user initiates a designation for an existing member (Contact) from the page.
export async function createAssignment(session, { req, memberId, designationId }) {
  await ensureApprovalSchema();
  const mid = parseInt(memberId, 10);
  if (!Number.isInteger(mid) || mid <= 0) return { error: "Select a valid member." };
  const did = parseInt(designationId, 10);
  if (!Number.isInteger(did) || did <= 0) return { error: "Select a valid designation." };

  const [member] = await query(
    `SELECT c.id, c.person_name, c.phone_number, c.photo_url, c.assembly_id, c.district_id, c.lok_sabha_id, c.zone_id,
            lw.id AS block_id, lw.name AS block_name
       FROM contacts c LEFT JOIN locations lw ON lw.id = c.ward_id WHERE c.id = ? LIMIT 1`,
    [mid]
  );
  if (!member) return { error: "The selected member could not be found." };
  const [desig] = await query("SELECT id, name FROM designations WHERE id = ? LIMIT 1", [did]);
  if (!desig) return { error: "The selected designation could not be found." };

  // Stage 1 is routed by Assembly, so the member must have one.
  const chain = await locationChain(query, member);
  if (!chain.assembly) return { error: "This member has no Assembly set, so the designation cannot be routed to a Vidhansabha Prabhari. Set the member's Assembly first." };

  const out = await withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const r = await createAssignmentTx(conn, {
        memberId: member.id, memberName: member.person_name, memberPhone: member.phone_number, memberPhotoUrl: member.photo_url,
        designationId: desig.id, designationName: desig.name,
        assembly: chain.assembly, district: chain.district, lokSabha: chain.lok_sabha, zone: chain.zone,
        block: member.block_id ? { id: member.block_id, name: member.block_name } : null,
        assignedByUserId: session?.user?.id ?? null, assignedByName: actorName(session), ip: ipOf(req),
      });
      await conn.commit();
      return r;
    } catch (e) { await conn.rollback(); throw e; }
  });
  if (!out.existing) await afterAssignmentCreated(session, out.id, { member: member.person_name, designation: desig.name, assembly: chain.assembly.name });
  return { ok: true, id: out.id, existing: out.existing };
}

// ---------------------------------------------------------------------------
// Approve / reject / return
// ---------------------------------------------------------------------------

// Shared guard for approve / reject / return: loads the assignment, and verifies the
// caller may act on its CURRENT stage. Returns { a, level, cfg } or { error, status }.
async function authorizeCurrentStage(session, id, verb) {
  const [a] = await query("SELECT * FROM designation_assignments WHERE id = ? LIMIT 1", [id]);
  if (!a) return { error: "Designation request not found.", status: 404 };
  if (a.status !== "pending") return { error: "This designation is no longer awaiting approval.", status: 409 };
  const level = a.current_level;
  const cfg = levelConfig(level);
  if (!cfg) return { error: "This designation is not in an approvable state.", status: 409 };
  const access = await buildAccess(session);
  if (cfg.superOnly) {
    if (!access.superAdmin) return { error: "Only Prabhari Ji (Super Admin) can give the final approval.", status: 403 };
  } else {
    if (!access.grants.has(cfg.key)) return { error: `Only the ${cfg.label} can ${verb} this stage right now.`, status: 403 };
    if (!scopeCovers(cfg, access.profile, a)) {
      return { error: `You are not the ${cfg.label} responsible for this ${SCOPE_LABEL[cfg.scope]}, so you cannot ${verb} it.`, status: 403 };
    }
  }
  if (sameId(a.assigned_by_user_id, access.uid) && !access.superAdmin) {
    return { error: "You cannot act on a designation you submitted yourself.", status: 403 };
  }
  return { a, level, cfg };
}

// Approve the CURRENT stage. Backend-enforced and concurrency-safe: row lock +
// conditional claim + an explicit "all earlier stages done" check, with the stage
// update and its history entry in ONE transaction (the record cannot advance
// without its audit row). Returns { ok, finalized } or { error, status }.
export async function approveLevel(session, { req, assignmentId, signature, remarks }) {
  await ensureApprovalSchema();
  const id = parseInt(assignmentId, 10);
  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid request.", status: 400 };
  const pre = await authorizeCurrentStage(session, id, "approve");
  if (pre.error) return pre;
  const { level, cfg } = pre;

  const name = actorName(session);
  const ip = ipOf(req);
  const sig = String(signature || "").trim() || name || "Approved";
  const note = String(remarks || "").trim() || null;

  const result = await withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [[a]] = await conn.query("SELECT status, current_level, cycle FROM designation_assignments WHERE id = ? FOR UPDATE", [id]);
      if (!a || a.status !== "pending" || a.current_level !== level) {
        await conn.rollback();
        return { error: "This designation moved to another stage — refresh and try again.", status: 409 };
      }
      // Every earlier stage must be satisfied (approved, or legacy carried-over).
      const [[open]] = await conn.query(
        `SELECT COUNT(*) AS n FROM designation_approvals WHERE assignment_id = ? AND approval_level < ? AND status NOT IN ('approved','legacy')`,
        [id, level]
      );
      if (Number(open.n) > 0) {
        await conn.rollback();
        return { error: "An earlier approval stage is not complete — stages cannot be skipped.", status: 409 };
      }
      // Claim this stage ONLY if still pending (the second concurrent request updates 0 rows).
      const [claim] = await conn.query(
        `UPDATE designation_approvals
            SET status = 'approved', approver_user_id = ?, approver_name = ?, approver_role = ?, signature = ?, remarks = ?, ip = ?, approved_at = NOW()
          WHERE assignment_id = ? AND approval_level = ? AND status = 'pending'`,
        [session?.user?.id ?? null, name, cfg.label, sig, note, ip, id, level]
      );
      if (!claim.affectedRows) {
        await conn.rollback();
        return { error: "This stage has already been approved.", status: 409 };
      }
      let finalized = false;
      if (level < TOTAL_LEVELS) {
        await conn.query("UPDATE designation_approvals SET status = 'pending' WHERE assignment_id = ? AND approval_level = ? AND status = 'locked'", [id, level + 1]);
        await conn.query("UPDATE designation_assignments SET current_level = ? WHERE id = ?", [level + 1, id]);
      } else {
        await conn.query(
          `UPDATE designation_assignments
              SET status = 'final_approved', current_level = ?, final_approved_at = NOW(),
                  final_approved_by_user_id = ?, final_approved_by_name = ?, certificate_status = 'available'
            WHERE id = ?`,
          [TOTAL_LEVELS + 1, session?.user?.id ?? null, name, id]
        );
        finalized = true;
      }
      await addHistory(conn, {
        assignmentId: id, cycle: a.cycle, stage: level, action: finalized ? "final_approved" : "approved",
        actorUserId: session?.user?.id, actorName: name, actorRole: cfg.label,
        previous: "pending", next: finalized ? "final_approved" : "approved", remarks: note, ip,
      });
      await conn.commit();
      return { ok: true, finalized, level };
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  });
  if (result.error) return result;

  await ensureAuditSchema();
  logAudit(session, {
    action: result.finalized ? "designation.approval.finalized" : "designation.approval.approved",
    entityType: "designation_assignment", entityId: id, details: { level, role: cfg.label, approver: name, finalized: result.finalized },
  });
  if (result.finalized) notifySubmitter(id, "Designation FINAL APPROVED — the certificate is now available.").catch(() => {});
  else notifyStage(id, level + 1, "A designation is now awaiting your approval.").catch(() => {});
  return result;
}

// Shared transition for reject (terminal) and return-for-correction (editable).
async function closeCurrentStage(session, { req, assignmentId, reason }, mode) {
  await ensureApprovalSchema();
  const id = parseInt(assignmentId, 10);
  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid request.", status: 400 };
  const why = String(reason || "").trim();
  if (!why) return { error: `A reason is required to ${mode === "return" ? "return for correction" : "reject"}.`, status: 400 };
  const pre = await authorizeCurrentStage(session, id, mode === "return" ? "return" : "reject");
  if (pre.error) return pre;
  const { level, cfg } = pre;
  const stageStatus = mode === "return" ? "returned" : "rejected";
  const name = actorName(session);
  const ip = ipOf(req);

  const result = await withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [[a]] = await conn.query("SELECT status, current_level, cycle FROM designation_assignments WHERE id = ? FOR UPDATE", [id]);
      if (!a || a.status !== "pending" || a.current_level !== level) {
        await conn.rollback();
        return { error: "This designation moved to another stage — refresh and try again.", status: 409 };
      }
      const [claim] = await conn.query(
        `UPDATE designation_approvals SET status = ?, approver_user_id = ?, approver_name = ?, approver_role = ?, remarks = ?, ip = ?, approved_at = NOW()
          WHERE assignment_id = ? AND approval_level = ? AND status = 'pending'`,
        [stageStatus, session?.user?.id ?? null, name, cfg.label, why, ip, id, level]
      );
      if (!claim.affectedRows) { await conn.rollback(); return { error: "This stage has already been processed.", status: 409 }; }
      if (mode === "return") {
        await conn.query(
          "UPDATE designation_assignments SET status = 'returned', returned_by_user_id = ?, returned_reason = ?, returned_at = NOW() WHERE id = ?",
          [session?.user?.id ?? null, why, id]
        );
      } else {
        await conn.query(
          "UPDATE designation_assignments SET status = 'rejected', rejected_by_user_id = ?, rejected_reason = ?, rejected_at = NOW() WHERE id = ?",
          [session?.user?.id ?? null, why, id]
        );
      }
      await addHistory(conn, {
        assignmentId: id, cycle: a.cycle, stage: level, action: stageStatus, actorUserId: session?.user?.id, actorName: name,
        actorRole: cfg.label, previous: "pending", next: stageStatus, remarks: why, ip,
      });
      await conn.commit();
      return { ok: true };
    } catch (e) { await conn.rollback(); throw e; }
  });
  if (result.error) return result;
  await ensureAuditSchema();
  logAudit(session, { action: `designation.approval.${stageStatus}`, entityType: "designation_assignment", entityId: id, details: { level, role: cfg.label, reason: why } });
  notifySubmitter(id, mode === "return" ? `Designation returned for correction at ${cfg.label}: ${why}` : `Designation rejected at ${cfg.label}: ${why}`).catch(() => {});
  return result;
}
export function rejectLevel(session, args) { return closeCurrentStage(session, args, "reject"); }
export function returnForCorrection(session, args) { return closeCurrentStage(session, args, "return"); }

// Resubmit a returned/rejected designation, or revise a still-pending one. Always
// RESTARTS the chain from stage 1 (a corrected or changed designation must never
// bypass a required stage) and records why. Earlier stage rows are reset for the new
// cycle but every earlier action stays in the append-only history. An approved
// (final) designation cannot be revised here — it needs a new assignment.
export async function reviseAssignment(session, { req, assignmentId, designationId, reason }) {
  await ensureApprovalSchema();
  const id = parseInt(assignmentId, 10);
  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid request.", status: 400 };
  const [pre] = await query("SELECT * FROM designation_assignments WHERE id = ? LIMIT 1", [id]);
  if (!pre) return { error: "Designation request not found.", status: 404 };
  if (pre.status === "final_approved") return { error: "A finally approved designation cannot be changed. Create a new designation assignment instead.", status: 409 };

  const access = await buildAccess(session);
  const may = access.fullView || sameId(pre.assigned_by_user_id, access.uid) || (await userCanAccessPageKey(session, INITIATE_KEY));
  if (!may || !access.canSee(pre)) return { error: "You are not allowed to resubmit this designation.", status: 403 };

  const wasPending = pre.status === "pending";
  const why = String(reason || "").trim();
  if (wasPending && !why) return { error: "A reason is required to change a designation that is already in approval.", status: 400 };

  let newDesig = null;
  if (designationId != null && String(designationId) !== "" && String(designationId) !== String(pre.designation_id)) {
    const did = parseInt(designationId, 10);
    [newDesig] = Number.isInteger(did) && did > 0 ? await query("SELECT id, name FROM designations WHERE id = ? LIMIT 1", [did]) : [];
    if (!newDesig) return { error: "The selected designation could not be found.", status: 400 };
  }
  const name = actorName(session);
  const ip = ipOf(req);

  const result = await withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [[a]] = await conn.query("SELECT status, cycle, designation_name FROM designation_assignments WHERE id = ? FOR UPDATE", [id]);
      if (!a || a.status === "final_approved") { await conn.rollback(); return { error: "This designation can no longer be changed.", status: 409 }; }
      const prevStatus = a.status;
      await conn.query(
        `UPDATE designation_approvals
            SET status = IF(approval_level = 1, 'pending', 'locked'), approver_user_id = NULL, approver_name = NULL, approver_role = NULL,
                signature = NULL, remarks = NULL, ip = NULL, approved_at = NULL
          WHERE assignment_id = ?`,
        [id]
      );
      const sets = ["status = 'pending'", "current_level = 1", "cycle = cycle + 1", "rejected_by_user_id = NULL", "rejected_reason = NULL", "rejected_at = NULL",
        "returned_by_user_id = NULL", "returned_reason = NULL", "returned_at = NULL", "certificate_status = 'not_available'"];
      const vals = [];
      if (newDesig) { sets.push("designation_id = ?", "designation_name = ?"); vals.push(newDesig.id, newDesig.name); }
      await conn.query(`UPDATE designation_assignments SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
      const note = [
        newDesig ? `Designation changed from "${a.designation_name}" to "${newDesig.name}".` : null,
        why || null,
      ].filter(Boolean).join(" ") || null;
      await addHistory(conn, {
        assignmentId: id, cycle: a.cycle + 1, stage: 1, action: wasPending ? "restarted" : "resubmitted",
        actorUserId: session?.user?.id, actorName: name, previous: prevStatus, next: "pending", remarks: note, ip,
      });
      await conn.commit();
      return { ok: true };
    } catch (e) {
      await conn.rollback();
      // The new designation may collide with this registration's other workflow.
      if (e?.code === "ER_DUP_ENTRY") return { error: "This registration already has an approval workflow for that designation.", status: 409 };
      throw e;
    }
  });
  if (result.error) return result;
  await ensureAuditSchema();
  logAudit(session, { action: "designation.approval.restarted", entityType: "designation_assignment", entityId: id, details: { reason: why || null, new_designation: newDesig?.name || null } });
  notifyStage(id, 1, "A designation was resubmitted and is awaiting your approval.").catch(() => {});
  return result;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getAssignment(id) {
  await ensureApprovalSchema();
  const [a] = await query("SELECT * FROM designation_assignments WHERE id = ? LIMIT 1", [id]);
  return a || null;
}

// The full 8-stage timeline, always every stage in order. Status labels: approved /
// pending (current approver must act) / waiting (an earlier stage is not done) /
// rejected / returned / legacy.
export async function getTimeline(id) {
  await ensureApprovalSchema();
  const rows = await query(
    "SELECT approval_level, required_role, required_key, status, approver_user_id, approver_name, approver_role, signature, remarks, approved_at FROM designation_approvals WHERE assignment_id = ? ORDER BY approval_level ASC",
    [id]
  );
  const byLevel = new Map(rows.map((r) => [r.approval_level, r]));
  return APPROVAL_LEVELS.map((l) => {
    const r = byLevel.get(l.level);
    const st = r?.status || "locked";
    return {
      level: l.level, role: l.label, scope: l.scope,
      status: st === "locked" ? "waiting" : st,
      approver_user_id: r?.approver_user_id ?? null,
      approver_name: r?.approver_name || null, approver_role: r?.approver_role || null,
      signature: r?.signature || null, remarks: r?.remarks || null, approved_at: r?.approved_at || null,
    };
  });
}

export async function getHistory(id) {
  await ensureApprovalSchema();
  return query(
    "SELECT id, cycle, stage, action, actor_user_id, actor_name, actor_role, previous_status, new_status, remarks, action_at FROM designation_approval_history WHERE assignment_id = ? ORDER BY id ASC",
    [id]
  );
}

function applyFilters(where, params, f, alias = "a") {
  const a = `${alias}.`;
  if (f.q) {
    where.push(`(${a}member_name LIKE ? OR ${a}designation_name LIKE ? OR ${a}member_phone LIKE ?)`);
    const l = `%${f.q}%`; params.push(l, l, l);
  }
  if (f.designation_id) { where.push(`${a}designation_id = ?`); params.push(f.designation_id); }
  if (f.status) { where.push(`${a}status = ?`); params.push(f.status); }
  if (f.level) { where.push(`${a}current_level = ?`); params.push(f.level); }
  if (f.assembly_id) { where.push(`${a}assembly_id = ?`); params.push(f.assembly_id); }
  if (f.district_id) { where.push(`${a}district_id = ?`); params.push(f.district_id); }
  if (f.lok_sabha_id) { where.push(`${a}lok_sabha_id = ?`); params.push(f.lok_sabha_id); }
  if (f.from) { where.push(`${a}created_at >= ?`); params.push(f.from); }
  if (f.to) { where.push(`${a}created_at < DATE_ADD(?, INTERVAL 1 DAY)`); params.push(f.to); }
}

// Attach the per-stage summary (every approver + time) and the pending-stage /
// missing-approver warning, so a list row can show the full picture.
async function decorate(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const stages = await query(
    `SELECT assignment_id, approval_level, status, approver_name, approved_at FROM designation_approvals WHERE assignment_id IN (${ids.map(() => "?").join(",")}) ORDER BY approval_level`,
    ids
  );
  const byA = new Map();
  for (const s of stages) { if (!byA.has(s.assignment_id)) byA.set(s.assignment_id, []); byA.get(s.assignment_id).push(s); }
  const cache = new Map();
  for (const r of rows) {
    r.stages = (byA.get(r.id) || []).map((s) => ({ level: s.approval_level, status: s.status === "locked" ? "waiting" : s.status, approver_name: s.approver_name, approved_at: s.approved_at }));
    const cfg = levelConfig(r.current_level);
    r.current_stage_label = r.status === "pending" && cfg ? cfg.label : null;
    r.missing_approver = false;
    if (r.status === "pending" && cfg) {
      const key = `${cfg.level}|${cfg.scope ? r[`${cfg.scope}_id`] : "*"}`;
      if (!cache.has(key)) cache.set(key, (await eligibleApprovers(cfg.level, r)).length);
      if (cache.get(key) === 0) {
        r.missing_approver = true;
        r.missing_approver_message = `No ${cfg.label}${cfg.scope ? ` is assigned for ${r[`${cfg.scope}_name`] || `this ${SCOPE_LABEL[cfg.scope]}`}` : " is assigned"}. The record stays pending at stage ${cfg.level} until one is mapped.`;
      }
    }
  }
  return rows;
}

// Fetch candidates by SQL filters, keep what this user may see, cap, and decorate.
async function visibleRows(session, extraWhere, extraParams, filters, order, extraSelect = "", join = "") {
  await ensureApprovalSchema();
  const access = await buildAccess(session);
  const where = [...extraWhere];
  const params = [...extraParams];
  applyFilters(where, params, filters || {}, "a");
  const rows = await query(
    `SELECT a.*${extraSelect} FROM designation_assignments a ${join} WHERE ${where.length ? where.join(" AND ") : "1=1"} ORDER BY ${order} LIMIT 3000`,
    params
  );
  const seen = rows.filter((r) => access.canSee(r)).slice(0, 500);
  return { rows: await decorate(seen), access };
}

// Records waiting for THIS user at a stage they hold (and are responsible for).
export async function pendingForUser(session, filters = {}) {
  await ensureApprovalSchema();
  const access = await buildAccess(session);
  if (!access.levels.length) return [];
  const where = ["a.status = 'pending'", `a.current_level IN (${access.levels.map(() => "?").join(",")})`];
  const params = [...access.levels];
  applyFilters(where, params, filters, "a");
  const rows = await query(`SELECT a.* FROM designation_assignments a WHERE ${where.join(" AND ")} ORDER BY a.created_at ASC LIMIT 3000`, params);
  return decorate(rows.filter((r) => access.canActNow(r)).slice(0, 500));
}

// Records this user has already acted on (approve / reject / return), with what they
// did and when, plus the record's CURRENT overall status and next stage.
export async function processedByUser(session, filters = {}) {
  await ensureApprovalSchema();
  const where = ["h.actor_user_id = ?", "h.action IN ('approved','final_approved','rejected','returned')"];
  const params = [session?.user?.id ?? -1];
  applyFilters(where, params, filters, "a");
  const rows = await query(
    `SELECT a.*, h.action AS my_action, h.stage AS my_level, h.action_at AS my_action_at, h.cycle AS my_cycle
       FROM designation_approval_history h JOIN designation_assignments a ON a.id = h.assignment_id
      WHERE ${where.join(" AND ")} ORDER BY h.action_at DESC, h.id DESC LIMIT 500`,
    params
  );
  return decorate(rows);
}
export const approvedByUser = processedByUser; // backwards-compatible name

// Every record — Super Admin / State Admin only.
export async function listAllAssignments(session, filters = {}) {
  const { rows, access } = await visibleRows(session, [], [], filters, "a.created_at DESC");
  if (!access.fullView) return [];
  return rows;
}

// Records this user submitted.
export async function initiatedByUser(session, filters = {}) {
  const { rows } = await visibleRows(session, ["a.assigned_by_user_id = ?"], [session?.user?.id ?? -1], filters, "a.created_at DESC");
  return rows;
}

export async function finalApprovedFor(session, filters = {}) {
  const { rows } = await visibleRows(session, ["a.status = 'final_approved'"], [], filters, "a.final_approved_at DESC");
  return rows;
}

export async function closedFor(session, filters = {}) {
  const { rows } = await visibleRows(session, ["a.status IN ('rejected','returned')"], [], filters, "a.updated_at DESC");
  return rows;
}

// Counts for the dashboard — all from the database, scoped to what this user may see.
export async function approvalCounts(session) {
  await ensureApprovalSchema();
  const access = await buildAccess(session);
  const all = await query("SELECT id, status, current_level, certificate_status, assigned_by_user_id, assembly_id, district_id, lok_sabha_id, zone_id FROM designation_assignments");
  const vis = all.filter((r) => access.canSee(r));
  const [{ n: processed }] = await query(
    "SELECT COUNT(DISTINCT assignment_id) AS n FROM designation_approval_history WHERE actor_user_id = ? AND action IN ('approved','final_approved','rejected','returned')",
    [access.uid ?? -1]
  );
  return {
    pending_my_approval: all.filter((r) => access.canActNow(r)).length,
    processed_by_me: Number(processed) || 0,
    approved_by_me: Number(processed) || 0,
    final_approved: vis.filter((r) => r.status === "final_approved").length,
    awaiting_final_approval: vis.filter((r) => r.status === "pending" && r.current_level === TOTAL_LEVELS).length,
    certificate_pending: vis.filter((r) => r.status === "final_approved" && r.certificate_status === "available").length,
    certificate_issued: vis.filter((r) => r.certificate_status === "issued").length,
    rejected_returned: vis.filter((r) => r.status === "rejected" || r.status === "returned").length,
  };
}

// ---------------------------------------------------------------------------
// Certificate
// ---------------------------------------------------------------------------

// The certificate is available ONLY when the assignment is FINAL APPROVED, every
// earlier stage is satisfied AND stage 8 carries Prabhari Ji's recorded approval.
export async function assertCertificateAllowed(assignmentId) {
  await ensureApprovalSchema();
  const a = await getAssignment(assignmentId);
  if (!a) return { error: "Designation request not found.", status: 404 };
  const msg = "Certificate cannot be generated because the designation approval process is not yet complete.";
  if (a.status !== "final_approved") return { error: msg, status: 409 };
  const rows = await query("SELECT approval_level, status, approver_user_id FROM designation_approvals WHERE assignment_id = ?", [assignmentId]);
  const done = rows.filter((r) => DONE.includes(r.status)).length;
  const last = rows.find((r) => r.approval_level === TOTAL_LEVELS);
  if (done < TOTAL_LEVELS || !last || last.status !== "approved" || !last.approver_user_id) return { error: msg, status: 409 };
  return { ok: true, assignment: a };
}

// Issue the certificate for a fully approved designation. Backend-gated and
// idempotent (the number is assigned once; re-issuing returns the same one). It is
// built from the approved snapshot, which is never edited after final approval.
export async function issueCertificate(session, { assignmentId }) {
  const gate = await assertCertificateAllowed(assignmentId);
  if (gate.error) return gate;
  const a = gate.assignment;
  const number = a.certificate_number || `AAP-CG-${new Date().getFullYear()}-${String(a.id).padStart(6, "0")}`;
  const first = a.certificate_status !== "issued";
  await withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      await conn.query(
        `UPDATE designation_assignments
            SET certificate_status = 'issued', certificate_number = ?, certificate_issued_by_user_id = COALESCE(certificate_issued_by_user_id, ?),
                certificate_issued_by_name = COALESCE(certificate_issued_by_name, ?), certificate_issued_at = COALESCE(certificate_issued_at, NOW())
          WHERE id = ? AND status = 'final_approved'`,
        [number, session?.user?.id ?? null, actorName(session), assignmentId]
      );
      if (first) {
        await addHistory(conn, {
          assignmentId, cycle: a.cycle, stage: TOTAL_LEVELS, action: "certificate_issued", actorUserId: session?.user?.id,
          actorName: actorName(session), previous: "available", next: "issued", remarks: `Certificate ${number}`,
        });
      }
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; }
  });
  await ensureAuditSchema();
  logAudit(session, { action: "designation.certificate.issued", entityType: "designation_assignment", entityId: assignmentId, details: { certificate_number: number } });
  return { ok: true, assignment: await getAssignment(assignmentId) };
}
