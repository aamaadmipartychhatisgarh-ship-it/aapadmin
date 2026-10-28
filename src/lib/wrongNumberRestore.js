import { getPool } from "@/lib/db";
import { hasWrongNumberColumn, hasWrongNumberDetailColumns } from "@/lib/contactExtras";

// Restore NOT IN SERVICE contacts from the Wrong Number section to the Contact List.
// A Wrong Number record is "Not in Service" when its saved wrong-number reason is "Not in service" OR its latest call status is
// "Not in Service" (SQL below). Restoring reuses the SAME contact row and the existing restore pattern: the Wrong Number flag and
// completion are cleared, locks released, restored_at / restored_by stamped - nothing else on the contact (id, phone, name, address,
// designation, zone, assignment, source, remarks) or its call history changes, and no row is ever inserted.
export const NOT_IN_SERVICE_SQL = (a = "c", withReason = true) =>
  `(${withReason ? `${a}.wrong_number_reason = 'not_in_service' OR ` : ""}(SELECT cs.name FROM calls x JOIN call_statuses cs ON cs.id = x.status_id
      WHERE x.contact_id = ${a}.id ORDER BY x.called_at DESC, x.id DESC LIMIT 1) = 'Not in Service')`;

// ids -> { eligible, already_restored, not_wrong_number(=not on the page), not_eligible }; dryRun only classifies.
export async function restoreNotInServiceContacts({ ids = [], userId = null, dryRun = false }) {
  if (!(await hasWrongNumberColumn())) return { status: 400, message: "Wrong Number feature not enabled." };
  const want = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 2000);
  if (!want.length) return { status: 400, message: "Select at least one contact." };
  const hasDetail = await hasWrongNumberDetailColumns();
  const NIS = NOT_IN_SERVICE_SQL("c", hasDetail);
  const pool = getPool();
  const classify = (row) => {
    if (!row) return "not_found";
    if (Number(row.is_wrong_number) !== 1) return "already_restored";   // no longer on the Wrong Number page
    if (!row.nis) return "not_eligible";                                  // a Wrong Number record with another status
    return "eligible";
  };
  const counts = { eligible: 0, already_restored: 0, not_eligible: 0, not_found: 0 };
  const eligibleIds = [], skipped = [];
  const rowSql = `SELECT c.id, c.is_wrong_number, ${NIS} AS nis FROM contacts c WHERE c.id = ?`;
  if (dryRun) {
    for (const id of want) {
      // eslint-disable-next-line no-await-in-loop
      const [rows] = await pool.query(rowSql, [id]);
      const c = classify(rows[0]); counts[c]++;
      if (c === "eligible") eligibleIds.push(id); else skipped.push({ id, reason: c });
    }
    return { status: 200, dry_run: true, selected: want.length, eligible: counts.eligible, eligible_ids: eligibleIds, counts, skipped };
  }
  const restoredIds = [], failed = [];
  for (const id of want) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("SELECT id FROM contacts WHERE id = ? FOR UPDATE", [id]);   // serialize: a repeat / concurrent restore sees it already restored
      const [rows] = await conn.query(rowSql, [id]);
      const c = classify(rows[0]);
      if (c !== "eligible") { await conn.rollback(); counts[c]++; skipped.push({ id, reason: c }); continue; }
      await conn.query(
        `UPDATE contacts SET is_wrong_number = 0, is_completed = 0, locked_by_user_id = NULL, locked_at = NULL${hasDetail ? ", restored_at = NOW(), restored_by = ?" : ""} WHERE id = ? AND is_wrong_number = 1`,
        hasDetail ? [userId, id] : [id]
      );
      await conn.commit();
      restoredIds.push(id);
    } catch (e) {
      await conn.rollback().catch(() => {});
      failed.push({ id, reason: "error" });
    } finally { conn.release(); }
  }
  const restored = restoredIds.length;
  return {
    status: 200, selected: want.length, restored, restored_ids: restoredIds, skipped, failed, counts,
    message: `${restored} contact${restored === 1 ? "" : "s"} restored to the Contact List.${skipped.length ? ` ${skipped.length} skipped (already restored or not Not in Service).` : ""}${failed.length ? ` ${failed.length} failed and were left unchanged.` : ""}`,
  };
}
