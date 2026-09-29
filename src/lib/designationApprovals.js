import { query, withConnection } from "@/lib/db";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { isSuperAdmin } from "@/lib/permissions";
import { ensureAuditSchema, logAudit } from "@/lib/audit";

// APPROVAL & DESIGNATION SYSTEM.
//
// A designation a Vidhansabha Prabhari assigns to a member is NOT final. It runs
// through a fixed 7-level sequential approval chain; only after Level 7 does it
// become FINAL APPROVED and the certificate become available. The sequence is
// enforced ENTIRELY in the backend (a level can be approved only when it is the
// assignment's current pending level and the caller holds that level's grant),
// never by the frontend alone.
//
// Reuses the existing architecture: a member is a `contacts` row; each approval
// level is gated by a Page-Access key (granted by a Super Admin in Page Access);
// actions are audited via logAudit; recipients are notified via the notifications
// table. Two normalized tables hold the workflow — no seven boolean columns.

// The mandatory approval order. `key` is the Page-Access grant a user needs to act
// at that level. Central config (§16) — never hardcode these names across the UI.
export const APPROVAL_LEVELS = [
  { level: 1, label: "District President", key: "approve_l1_district_president" },
  { level: 2, label: "Lok Sabha Adhyaksh", key: "approve_l2_loksabha_adhyaksh" },
  { level: 3, label: "Lok Sabha Prabhari", key: "approve_l3_loksabha_prabhari" },
  { level: 4, label: "Pradesh Sangathan Mantri", key: "approve_l4_sangathan_mantri" },
  { level: 5, label: "Pradesh Karyakari Adhyaksh", key: "approve_l5_karyakari_adhyaksh" },
  { level: 6, label: "Sah Prabhari", key: "approve_l6_sah_prabhari" },
  { level: 7, label: "Prabhari Ji", key: "approve_l7_prabhari_ji" },
];
export const TOTAL_LEVELS = APPROVAL_LEVELS.length; // 7
export const levelConfig = (n) => APPROVAL_LEVELS.find((l) => l.level === Number(n)) || null;
// The Page-Access key a Vidhansabha Prabhari needs to INITIATE a designation.
export const INITIATE_KEY = "approval_initiate";
// The page key for viewing the Approval Center.
export const APPROVALS_PAGE_KEY = "approvals";

let ensured = false;
export async function ensureApprovalSchema() {
  if (ensured) return;
  try {
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
    ensured = true;
  } catch (e) {
    console.error("[approvals] ensureApprovalSchema:", e?.message || e);
  }
}

function ipOf(req) {
  try {
    const h = req?.headers;
    return (h?.get("x-forwarded-for")?.split(",")[0]?.trim()) || h?.get("x-real-ip") || null;
  } catch { return null; }
}

// The levels a user may approve at, derived from their SERVER-SIDE grants (never
// the client). Super Admin may act at any level (still one level at a time).
export async function userApprovalLevels(session) {
  if (isSuperAdmin(session)) return APPROVAL_LEVELS.map((l) => l.level);
  const out = [];
  for (const l of APPROVAL_LEVELS) {
    // eslint-disable-next-line no-await-in-loop
    if (await userCanAccessPageKey(session, l.key)) out.push(l.level);
  }
  return out;
}

// --- create (initiate) ------------------------------------------------------

// A Vidhansabha Prabhari initiates a designation for a member. Snapshots the
// member + designation + location, creates the assignment as Pending Approval,
// and seeds the 7 approval rows (level 1 pending, 2–7 locked). Never mutates the
// contact/member record.
export async function createAssignment(session, { req, memberId, designationId }) {
  await ensureApprovalSchema();
  const mid = parseInt(memberId, 10);
  if (!Number.isInteger(mid) || mid <= 0) return { error: "Select a valid member." };
  const did = parseInt(designationId, 10);
  if (!Number.isInteger(did) || did <= 0) return { error: "Select a valid designation." };

  // Snapshot the member (contact) + its resolved location, and the designation.
  const [member] = await query(
    `SELECT c.id, c.person_name, c.phone_number, c.photo_url,
            c.assembly_id, c.district_id, c.lok_sabha_id, c.zone_id,
            la.name AS assembly_name, ld.name AS district_name,
            COALESCE(cls.name, lls.name) AS lok_sabha_name,
            COALESCE(cz.name, lz.name) AS zone_name
       FROM contacts c
       LEFT JOIN locations la ON la.id = c.assembly_id
       LEFT JOIN locations ld ON ld.id = c.district_id
       LEFT JOIN locations lls ON lls.id = ld.parent_id
       LEFT JOIN locations cls ON cls.id = c.lok_sabha_id
       LEFT JOIN locations lz ON lz.id = lls.parent_id
       LEFT JOIN locations cz ON cz.id = c.zone_id
      WHERE c.id = ? LIMIT 1`,
    [mid]
  );
  if (!member) return { error: "The selected member could not be found." };
  const [desig] = await query("SELECT id, name FROM designations WHERE id = ? LIMIT 1", [did]);
  if (!desig) return { error: "The selected designation could not be found." };

  const res = await query(
    `INSERT INTO designation_assignments
       (member_id, member_name, member_phone, member_photo_url, designation_id, designation_name,
        assembly_id, assembly_name, district_id, district_name, lok_sabha_id, lok_sabha_name,
        zone_id, zone_name, assigned_by_user_id, assigned_by_name, status, current_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)`,
    [
      member.id, member.person_name, member.phone_number || null, member.photo_url || null,
      desig.id, desig.name,
      member.assembly_id || null, member.assembly_name || null,
      member.district_id || null, member.district_name || null,
      member.lok_sabha_id || null, member.lok_sabha_name || null,
      member.zone_id || null, member.zone_name || null,
      session?.user?.id ?? null, session?.user?.name || session?.user?.username || null,
    ]
  );
  const assignmentId = res.insertId;

  for (const l of APPROVAL_LEVELS) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT INTO designation_approvals (assignment_id, approval_level, required_role, required_key, status)
       VALUES (?, ?, ?, ?, ?)`,
      [assignmentId, l.level, l.label, l.key, l.level === 1 ? "pending" : "locked"]
    );
  }

  await ensureAuditSchema();
  logAudit(session, {
    action: "designation.approval.created", entityType: "designation_assignment", entityId: assignmentId,
    details: { member: member.person_name, designation: desig.name, assembly: member.assembly_name },
  });
  notifyLevelApprovers(assignmentId, 1, `New designation awaiting your approval: ${desig.name} — ${member.person_name}`).catch(() => {});
  return { ok: true, id: assignmentId };
}

// --- approve ----------------------------------------------------------------

// Approve the assignment's CURRENT pending level. Fully backend-enforced and
// concurrency-safe (row lock + conditional claim). The caller (route) has already
// confirmed a session; authorization for the specific current level is verified
// HERE from server-side grants, so a payload can never approve on someone's behalf
// or skip a level. Returns { ok, finalized } or { error, status }.
export async function approveLevel(session, { req, assignmentId, signature, remarks }) {
  await ensureApprovalSchema();
  const id = parseInt(assignmentId, 10);
  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid request.", status: 400 };

  // Read the current level first to know which grant to require (re-verified under
  // lock below, so a race can't let it slip through).
  const [pre] = await query("SELECT status, current_level FROM designation_assignments WHERE id = ? LIMIT 1", [id]);
  if (!pre) return { error: "Designation request not found.", status: 404 };
  if (pre.status !== "pending") return { error: "This designation is no longer awaiting approval.", status: 409 };
  const level = pre.current_level;
  const cfg = levelConfig(level);
  if (!cfg) return { error: "This designation is not in an approvable state.", status: 409 };

  // AUTHORIZATION — the caller must hold this exact level's grant (or be Super
  // Admin). Derived from the session's server-side permissions, never the payload.
  const authorized = isSuperAdmin(session) || (await userCanAccessPageKey(session, cfg.key));
  if (!authorized) {
    return { error: `Only the ${cfg.label} can approve this level right now.`, status: 403 };
  }

  const approverName = session?.user?.name || session?.user?.username || null;
  const ip = ipOf(req);
  const sig = String(signature || "").trim() || approverName || "Approved";

  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [[a]] = await conn.query("SELECT status, current_level FROM designation_assignments WHERE id = ? FOR UPDATE", [id]);
      if (!a || a.status !== "pending" || a.current_level !== level) {
        await conn.rollback();
        return { error: "This designation moved to another stage — refresh and try again.", status: 409 };
      }
      // Claim this level ONLY if it is still pending (prevents a duplicate/double
      // approval — the second concurrent request updates 0 rows).
      const [claim] = await conn.query(
        `UPDATE designation_approvals
            SET status = 'approved', approver_user_id = ?, approver_name = ?, approver_role = ?,
                signature = ?, remarks = ?, ip = ?, approved_at = NOW()
          WHERE assignment_id = ? AND approval_level = ? AND status = 'pending'`,
        [session?.user?.id ?? null, approverName, cfg.label, sig, String(remarks || "").trim() || null, ip, id, level]
      );
      if (!claim.affectedRows) {
        await conn.rollback();
        return { error: "This level has already been approved.", status: 409 };
      }
      let finalized = false;
      if (level < TOTAL_LEVELS) {
        await conn.query("UPDATE designation_approvals SET status = 'pending' WHERE assignment_id = ? AND approval_level = ?", [id, level + 1]);
        await conn.query("UPDATE designation_assignments SET current_level = ? WHERE id = ?", [level + 1, id]);
      } else {
        await conn.query(
          "UPDATE designation_assignments SET status = 'final_approved', current_level = ?, final_approved_at = NOW(), certificate_status = 'available' WHERE id = ?",
          [TOTAL_LEVELS + 1, id]
        );
        finalized = true;
      }
      await conn.commit();

      await ensureAuditSchema();
      logAudit(session, {
        action: finalized ? "designation.approval.finalized" : "designation.approval.approved",
        entityType: "designation_assignment", entityId: id,
        details: { level, role: cfg.label, approver: approverName, finalized },
      });
      if (finalized) {
        notifyAssignmentOwner(id, "Designation FINAL APPROVED — certificate is now available.").catch(() => {});
      } else {
        notifyLevelApprovers(id, level + 1, "A designation is now awaiting your approval.").catch(() => {});
      }
      return { ok: true, finalized, level };
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  });
}

// --- reject (§12) -----------------------------------------------------------

// Reject the current level. The assignment goes to 'rejected' (not final), the
// reason is stored, and the approval history is PRESERVED (never deleted). Restore
// is an explicit re-initiation, so we don't silently re-open the chain.
export async function rejectLevel(session, { req, assignmentId, reason }) {
  await ensureApprovalSchema();
  const id = parseInt(assignmentId, 10);
  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid request.", status: 400 };
  const [pre] = await query("SELECT status, current_level FROM designation_assignments WHERE id = ? LIMIT 1", [id]);
  if (!pre) return { error: "Designation request not found.", status: 404 };
  if (pre.status !== "pending") return { error: "This designation is no longer awaiting approval.", status: 409 };
  const cfg = levelConfig(pre.current_level);
  if (!cfg) return { error: "Not in an approvable state.", status: 409 };
  const authorized = isSuperAdmin(session) || (await userCanAccessPageKey(session, cfg.key));
  if (!authorized) return { error: `Only the ${cfg.label} can act on this level.`, status: 403 };
  const why = String(reason || "").trim();
  if (!why) return { error: "A reason is required to reject.", status: 400 };

  await query(
    `UPDATE designation_approvals SET status = 'rejected', approver_user_id = ?, approver_name = ?, approver_role = ?, remarks = ?, ip = ?, approved_at = NOW()
      WHERE assignment_id = ? AND approval_level = ? AND status = 'pending'`,
    [session?.user?.id ?? null, session?.user?.name || null, cfg.label, why, ipOf(req), id, pre.current_level]
  );
  await query(
    "UPDATE designation_assignments SET status = 'rejected', rejected_by_user_id = ?, rejected_reason = ?, rejected_at = NOW() WHERE id = ?",
    [session?.user?.id ?? null, why, id]
  );
  await ensureAuditSchema();
  logAudit(session, { action: "designation.approval.rejected", entityType: "designation_assignment", entityId: id, details: { level: pre.current_level, role: cfg.label, reason: why } });
  notifyAssignmentOwner(id, `Designation rejected at ${cfg.label}: ${why}`).catch(() => {});
  return { ok: true };
}

// --- reads ------------------------------------------------------------------

export async function getAssignment(id) {
  await ensureApprovalSchema();
  const [a] = await query("SELECT * FROM designation_assignments WHERE id = ? LIMIT 1", [id]);
  return a || null;
}

// The full 7-step timeline for an assignment, always returned in level order with
// every level present (locked ones included) so the UI stepper is complete.
export async function getTimeline(id) {
  await ensureApprovalSchema();
  const rows = await query(
    "SELECT approval_level, required_role, required_key, status, approver_name, approver_role, signature, remarks, approved_at FROM designation_approvals WHERE assignment_id = ? ORDER BY approval_level ASC",
    [id]
  );
  const byLevel = new Map(rows.map((r) => [r.approval_level, r]));
  return APPROVAL_LEVELS.map((l) => {
    const r = byLevel.get(l.level);
    return {
      level: l.level,
      role: l.label,
      status: r?.status || "locked",
      approver_name: r?.approver_name || null,
      approver_role: r?.approver_role || null,
      signature: r?.signature || null,
      remarks: r?.remarks || null,
      approved_at: r?.approved_at || null,
    };
  });
}

// Assignments currently waiting for THIS user to act on (their level == current
// pending level). Empty for a user with no approval grant.
export async function pendingForUser(session, filters = {}) {
  await ensureApprovalSchema();
  const levels = await userApprovalLevels(session);
  if (!levels.length) return [];
  const where = ["a.status = 'pending'", `a.current_level IN (${levels.map(() => "?").join(",")})`];
  const params = [...levels];
  applyFilters(where, params, filters);
  return query(
    `SELECT a.* FROM designation_assignments a WHERE ${where.join(" AND ")} ORDER BY a.created_at ASC LIMIT 500`,
    params
  );
}

// Assignments this user has personally approved (their signature is on record),
// with the overall current status so they can see where each one is now (§7).
export async function approvedByUser(session, filters = {}) {
  await ensureApprovalSchema();
  const where = ["ap.approver_user_id = ?", "ap.status = 'approved'"];
  const params = [session?.user?.id ?? -1];
  applyFilters(where, params, filters, "a");
  return query(
    `SELECT a.*, ap.approval_level AS my_level, ap.approved_at AS my_approved_at, ap.required_role AS my_role
       FROM designation_approvals ap JOIN designation_assignments a ON a.id = ap.assignment_id
      WHERE ${where.join(" AND ")} ORDER BY ap.approved_at DESC LIMIT 500`,
    params
  );
}

// All assignments (oversight/admin view) with filters (§15).
export async function listAllAssignments(filters = {}) {
  await ensureApprovalSchema();
  const where = ["1=1"];
  const params = [];
  applyFilters(where, params, filters);
  return query(
    `SELECT a.* FROM designation_assignments a WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC LIMIT 1000`,
    params
  );
}

// Assignments this user (a Vidhansabha Prabhari) initiated (§14).
export async function initiatedByUser(session, filters = {}) {
  await ensureApprovalSchema();
  const where = ["a.assigned_by_user_id = ?"];
  const params = [session?.user?.id ?? -1];
  applyFilters(where, params, filters);
  return query(
    `SELECT a.* FROM designation_assignments a WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC LIMIT 500`,
    params
  );
}

function applyFilters(where, params, f, alias = "a") {
  const a = `${alias}.`;
  if (f.q) { where.push(`(${a}member_name LIKE ? OR ${a}designation_name LIKE ? OR ${a}member_phone LIKE ?)`); const l = `%${f.q}%`; params.push(l, l, l); }
  if (f.status) { where.push(`${a}status = ?`); params.push(f.status); }
  if (f.level) { where.push(`${a}current_level = ?`); params.push(f.level); }
  if (f.assembly_id) { where.push(`${a}assembly_id = ?`); params.push(f.assembly_id); }
  if (f.district_id) { where.push(`${a}district_id = ?`); params.push(f.district_id); }
  if (f.lok_sabha_id) { where.push(`${a}lok_sabha_id = ?`); params.push(f.lok_sabha_id); }
}

// Dashboard counts for the current user (§20).
export async function approvalCounts(session) {
  await ensureApprovalSchema();
  const levels = await userApprovalLevels(session);
  const uid = session?.user?.id ?? -1;
  const pendingMine = levels.length
    ? (await query(`SELECT COUNT(*) AS n FROM designation_assignments WHERE status='pending' AND current_level IN (${levels.map(() => "?").join(",")})`, levels))[0]?.n
    : 0;
  const [{ n: approvedByMe }] = await query("SELECT COUNT(*) AS n FROM designation_approvals WHERE approver_user_id = ? AND status='approved'", [uid]);
  const [{ n: finalApproved }] = await query("SELECT COUNT(*) AS n FROM designation_assignments WHERE status='final_approved'");
  const [{ n: certPending }] = await query("SELECT COUNT(*) AS n FROM designation_assignments WHERE status='final_approved' AND certificate_status='available'");
  const [{ n: certIssued }] = await query("SELECT COUNT(*) AS n FROM designation_assignments WHERE certificate_status='issued'");
  return {
    pending_my_approval: Number(pendingMine) || 0,
    approved_by_me: Number(approvedByMe) || 0,
    final_approved: Number(finalApproved) || 0,
    certificate_pending: Number(certPending) || 0,
    certificate_issued: Number(certIssued) || 0,
  };
}

// --- certificate (§10, §11) -------------------------------------------------

// Backend gate — the certificate is available ONLY when the assignment is final
// approved AND all 7 approval rows are recorded 'approved'. Returns {ok} or
// {error} with the required message.
export async function assertCertificateAllowed(assignmentId) {
  await ensureApprovalSchema();
  const a = await getAssignment(assignmentId);
  if (!a) return { error: "Designation request not found.", status: 404 };
  if (a.status !== "final_approved") {
    return { error: "Certificate cannot be generated because the designation approval process is not yet complete.", status: 409 };
  }
  const [{ n }] = await query("SELECT COUNT(*) AS n FROM designation_approvals WHERE assignment_id = ? AND status = 'approved'", [assignmentId]);
  if (Number(n) < TOTAL_LEVELS) {
    return { error: "Certificate cannot be generated because the designation approval process is not yet complete.", status: 409 };
  }
  return { ok: true, assignment: a };
}

// Generate / issue the certificate for a fully-approved designation. Backend
// gated; assigns a stable certificate number once. Idempotent — regenerating
// returns the existing number.
export async function issueCertificate(session, { assignmentId }) {
  const gate = await assertCertificateAllowed(assignmentId);
  if (gate.error) return gate;
  const a = gate.assignment;
  let number = a.certificate_number;
  if (!number) {
    const year = new Date().getFullYear();
    number = `AAP-CG-${year}-${String(a.id).padStart(6, "0")}`;
  }
  await query(
    "UPDATE designation_assignments SET certificate_status='issued', certificate_number=?, certificate_issued_by_user_id=?, certificate_issued_at=COALESCE(certificate_issued_at, NOW()) WHERE id=?",
    [number, session?.user?.id ?? null, assignmentId]
  );
  await ensureAuditSchema();
  logAudit(session, { action: "designation.certificate.issued", entityType: "designation_assignment", entityId: assignmentId, details: { certificate_number: number } });
  const fresh = await getAssignment(assignmentId);
  return { ok: true, assignment: fresh };
}

// --- notifications (best-effort; reuses the existing notifications table) -----

async function notifyLevelApprovers(assignmentId, level, message) {
  const cfg = levelConfig(level);
  if (!cfg) return;
  try {
    // Users who hold this level's grant (Page Access). Best-effort — if the table
    // isn't present the notification is simply skipped.
    const rows = await query("SELECT user_id FROM page_permissions WHERE page_key = ?", [cfg.key]);
    for (const r of rows) {
      // eslint-disable-next-line no-await-in-loop
      await query(
        `INSERT INTO notifications (user_id, type, severity, title, body, link, is_read)
         VALUES (?, 'approval_pending', 'info', ?, ?, ?, 0)`,
        [r.user_id, `Approval pending — ${cfg.label}`, message, "/dashboard/admin/approvals"]
      ).catch(() => {});
    }
  } catch { /* notifications optional */ }
}

async function notifyAssignmentOwner(assignmentId, message) {
  try {
    const [a] = await query("SELECT assigned_by_user_id, designation_name FROM designation_assignments WHERE id = ?", [assignmentId]);
    if (!a?.assigned_by_user_id) return;
    await query(
      `INSERT INTO notifications (user_id, type, severity, title, body, link, is_read)
       VALUES (?, 'approval_update', 'info', ?, ?, ?, 0)`,
      [a.assigned_by_user_id, "Designation approval update", message, "/dashboard/admin/approvals"]
    ).catch(() => {});
  } catch { /* optional */ }
}
