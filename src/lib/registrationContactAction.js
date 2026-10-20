import { query } from "@/lib/db";

// Communication actions a user can INITIATE on a registration record from a list.
// Recording one only notes the click — it never means the call was answered or the
// message delivered.
export const CONTACT_ACTIONS = ["call", "sms", "whatsapp"];

export function normalizeContactAction(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return CONTACT_ACTIONS.includes(s) ? s : null;
}

// Stamp the latest action on the SAME reg_people row (no new person row) and log
// it. updated_at is left as it was, so it still means "last edited".
export async function recordContactAction(personId, action, { userId = null, workerId = null } = {}) {
  await query(
    "UPDATE reg_people SET last_contact_action = ?, last_contact_at = NOW(), updated_at = updated_at WHERE id = ?",
    [action, personId]
  );
  await query(
    "INSERT INTO reg_contact_actions (person_id, action, by_user_id, by_worker_id) VALUES (?, ?, ?, ?)",
    [personId, action, userId, workerId]
  );
  const [row] = await query("SELECT id, last_contact_action, last_contact_at FROM reg_people WHERE id = ?", [personId]);
  return row;
}

// ORDER BY prefix: records with no communication action first.
export const UNCONTACTED_FIRST_SQL = "(p.last_contact_at IS NOT NULL) ASC";
