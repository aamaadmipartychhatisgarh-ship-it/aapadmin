import { query } from "@/lib/db";
import { hasWrongNumberColumn, ensureNotInterestedColumns } from "@/lib/contactExtras";
import { isContactInRepeatOffList } from "@/lib/repeatOff";

// Where does a contact live RIGHT NOW? Every contact is in exactly one place in the
// UI: a special list (Wrong Numbers, Not Interested, 10+ Switched Off, 10+ Incoming
// Off — checked in that order, the same precedence the lists themselves apply) or
// Main Contacts. Restore endpoints report this after moving a contact, so the admin
// sees the real destination (e.g. a contact restored from "10+ Switched Off" that is
// still flagged Wrong Number lands in Wrong Numbers, not Main).
export const LIST_LABELS = {
  main: "Main Contacts",
  wrong: "Wrong Numbers",
  not_interested: "Not Interested",
  switched: "10+ Times Switched Off",
  incoming: "10+ Times Incoming Off",
};

export async function contactListLocation(contactId) {
  const wantWrong = await hasWrongNumberColumn();
  const wantNI = await ensureNotInterestedColumns();
  const sel = [
    wantWrong ? "COALESCE(c.is_wrong_number, 0) AS wrong" : "0 AS wrong",
    wantNI ? "COALESCE(c.is_not_interested, 0) AS ni" : "0 AS ni",
  ].join(", ");
  const [row] = await query(`SELECT ${sel} FROM contacts c WHERE c.id = ?`, [contactId]);
  if (!row) return null;
  let key = "main";
  if (Number(row.wrong) === 1) key = "wrong";
  else if (Number(row.ni) === 1) key = "not_interested";
  else if (await isContactInRepeatOffList(contactId, "switched")) key = "switched";
  else if (await isContactInRepeatOffList(contactId, "incoming")) key = "incoming";
  return { key, label: LIST_LABELS[key] };
}
