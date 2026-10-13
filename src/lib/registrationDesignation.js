import { query } from "@/lib/db";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";

// Designation assignment from the Voter / Worker Registration forms.
//
// Only a Block President or a Vidhansabha Prabhari may attach a designation to a
// registration. That is decided HERE, on the server, from the signed-in karyakarta's
// real organisational record (their linked Contact's designations in the Designation
// Master) — never from anything the browser sends.

// Block President (and its Adhyaksh / Pramukh spellings used in the master).
const BLOCK_PRESIDENT = /block.*(president|adhyaksh|pramukh)|(president|adhyaksh|pramukh).*block/i;
// Vidhansabha Prabhari in any spelling, excluding the deputy (Sah / Seh Prabhari) —
// the same rule the Assembly Prabhari resolver uses.
const VIDHANSABHA_PRABHARI = /(vidhan ?sabha|vidhansbha|vidhansbaha|assembly).*prabhari/i;
const DEPUTY = /(seh|sah|sah-)[ -]?prabhari/i;

export function assignerLabel(designationName) {
  const n = String(designationName || "");
  if (VIDHANSABHA_PRABHARI.test(n) && !DEPUTY.test(n)) return "Vidhansabha Prabhari";
  if (BLOCK_PRESIDENT.test(n)) return "Block President";
  return null;
}

const last10 = (v) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : null; };

// Who is submitting? `regWorkerId` is the OTP-verified karyakarta (from the signed
// session). Returns { eligible, label, contactId, userId, name } — eligible only when
// their linked Contact holds a Block President / Vidhansabha Prabhari designation.
export async function resolveRegistrationSubmitter(regWorkerId) {
  const none = { eligible: false, label: null, contactId: null, userId: null, name: null };
  const rid = parseInt(regWorkerId, 10);
  if (!Number.isInteger(rid) || rid <= 0) return none;
  const [w] = await query("SELECT id, name, mobile, contact_id FROM reg_workers WHERE id = ? LIMIT 1", [rid]);
  if (!w) return none;

  // The karyakarta's Contact: the stored link, else a last-10-digit mobile match.
  let contactId = w.contact_id || null;
  if (!contactId && last10(w.mobile)) {
    const [c] = await query(
      `SELECT id FROM contacts
        WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+',''),'(',''),')',''),'.',''), 10) = ?
        ORDER BY id LIMIT 1`,
      [last10(w.mobile)]
    );
    contactId = c?.id || null;
  }
  if (!contactId) return { ...none, name: w.name };

  await ensureContactDesignationsSchema();
  const names = await query(
    `SELECT d.name FROM designations d
      WHERE d.id IN (SELECT cd.designation_id FROM contact_designations cd WHERE cd.contact_id = ?)
         OR d.id = (SELECT designation_id FROM contacts WHERE id = ?)`,
    [contactId, contactId]
  );
  let label = null;
  for (const r of names) { label = assignerLabel(r.name); if (label) break; }

  // A user account tied to that Contact (portal / member account), when one exists —
  // lets the approval chain block self-approval of one's own submission.
  const [u] = await query("SELECT id FROM users WHERE contact_id = ? LIMIT 1", [contactId]).catch(() => []);
  return { eligible: !!label, label, contactId, userId: u?.id || null, name: w.name };
}

async function hasColumn(table, col) {
  const r = await query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
    [table, col]
  );
  return r.length > 0;
}

// The designations a submitter may choose from — straight from the Designation
// Master (nothing hard-coded), in the master's own order, skipping disabled ones.
export async function listAssignableDesignations() {
  const enabled = (await hasColumn("designations", "enabled")) ? "WHERE (enabled = 1 OR enabled IS NULL)" : "";
  const order = (await hasColumn("designations", "sort_order")) ? "ORDER BY (sort_order IS NULL), sort_order, name" : "ORDER BY name";
  return query(`SELECT id, name FROM designations ${enabled} ${order}`);
}

// A registered person's matching Contact (so the approval links to the existing
// member rather than creating a new one). Null when they are not in Contacts.
export async function findContactByMobile(mobile) {
  const k = last10(mobile);
  if (!k) return null;
  const [c] = await query(
    `SELECT id FROM contacts
      WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone_number,' ',''),'-',''),'+',''),'(',''),')',''),'.',''), 10) = ?
      ORDER BY id LIMIT 1`,
    [k]
  );
  return c?.id || null;
}
