import { query } from "@/lib/db";

// Which contacts a CALLER (a user without Contacts management rights) may open
// and edit: one they currently hold (locked mid-call), one ASSIGNED to them, or
// one they have already called — so "Edit in Workspace" from My Calls still works
// after the lock expired and the contact went back to the pool. No admin
// permission is implied. This is the ONE rule shared by the contact read/edit
// (/api/contacts/[id]) and the contact photo (/api/contacts/[id]/photo) routes, so
// a caller can never save a contact's details but be refused its photo.
export async function callerOwnsContact(id, userId) {
  const [row] = await query("SELECT locked_by_user_id, assigned_to_user_id FROM contacts WHERE id = ?", [id]);
  if (!row) return false;
  if (String(row.locked_by_user_id) === String(userId) || String(row.assigned_to_user_id) === String(userId)) return true;
  try {
    const called = await query("SELECT 1 FROM calls WHERE contact_id = ? AND user_id = ? LIMIT 1", [id, userId]);
    return called.length > 0;
  } catch { return false; }
}
