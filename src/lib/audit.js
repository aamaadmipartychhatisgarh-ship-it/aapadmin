import { query } from "@/lib/db";

// Lazily create the audit trail table (idempotent) so auditing works on any
// deployment even before the manual migration script has been run.
let auditEnsured = false;
export async function ensureAuditSchema() {
  if (auditEnsured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS audit_logs (
         id INT AUTO_INCREMENT PRIMARY KEY,
         actor_user_id INT NULL,
         actor_name VARCHAR(255) NULL,
         action VARCHAR(64) NOT NULL,
         entity_type VARCHAR(64) NULL,
         entity_id VARCHAR(64) NULL,
         details TEXT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_audit_created (created_at),
         INDEX idx_audit_actor (actor_user_id),
         INDEX idx_audit_action (action),
         INDEX idx_audit_entity (entity_type)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    auditEnsured = true;
  } catch { /* never let auditing setup break an action */ }
}

// Record a sensitive/destructive action to audit_logs. Best-effort: any failure
// (table missing pre-migration, etc.) is swallowed so it can never break the
// action being audited. Fire-and-forget — callers don't need to await.
export async function logAudit(session, { action, entityType = null, entityId = null, details = null }) {
  try {
    await query(
      `INSERT INTO audit_logs (actor_user_id, actor_name, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        session?.user?.id ?? null,
        session?.user?.name || session?.user?.username || null,
        String(action).slice(0, 64),
        entityType ? String(entityType).slice(0, 64) : null,
        entityId != null ? String(entityId).slice(0, 64) : null,
        details ? JSON.stringify(details).slice(0, 4000) : null,
      ]
    );
  } catch {
    // Never let auditing failures surface to the user.
  }
}

// Human labels for the master-data modules that get audited. The stored
// entity_type is `master_data:<key>`, so the Audit page can list ONLY master-data
// changes and offer a per-master filter without touching other audit entries.
export const MASTER_LABELS = {
  designation: "Designation Master",
  wing: "Wing Master",
  wing_designation: "Wing Designation Master",
  party: "Party Master",
  caste: "Caste Master",
  polling_station: "Polling Station Master",
};

// Extract the caller's IP + source page from the request, best-effort.
function requestMeta(req) {
  try {
    const h = req?.headers;
    const ip = (h?.get("x-forwarded-for")?.split(",")[0]?.trim()) || h?.get("x-real-ip") || null;
    const source = h?.get("referer") || (req?.url ? new URL(req.url).pathname : null);
    return { ip: ip || null, source: source || null };
  } catch { return { ip: null, source: null }; }
}

// Record a MASTER-DATA change (create / edit / delete / activate / deactivate /
// reorder) in the shared audit trail. Reuses audit_logs + the existing session/
// user model — no separate audit store. `action` is a human verb; before/after
// hold the changed values so the Audit page can show Previous vs New. Fire-and-
// forget; never throws.
export async function logMasterDataChange(session, { req = null, master, action, recordId = null, recordName = null, before = null, after = null } = {}) {
  try {
    await ensureAuditSchema();
    const { ip, source } = requestMeta(req);
    await query(
      `INSERT INTO audit_logs (actor_user_id, actor_name, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        session?.user?.id ?? null,
        session?.user?.name || session?.user?.username || null,
        String(action).slice(0, 64),
        `master_data:${String(master).slice(0, 50)}`,
        recordId != null ? String(recordId).slice(0, 64) : null,
        JSON.stringify({
          master: MASTER_LABELS[master] || master,
          master_key: master,
          name: recordName ?? null,
          before: before ?? null,
          after: after ?? null,
          ip,
          source,
        }).slice(0, 4000),
      ]
    );
  } catch {
    // Auditing must never break the master-data change itself.
  }
}
