import { query } from "@/lib/db";

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
