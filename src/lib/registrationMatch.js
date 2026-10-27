import { query, getPool } from "@/lib/db";
import { last10Sql, phoneKey } from "@/lib/phone";
import { hasApprovalStatusColumn } from "@/lib/contactExtras";

// Phone matching for Worker / Voter Registration against the Contact List and the registration records.
// The identity of a person is their NORMALISED phone number - the last 10 digits, whatever the formatting
// ("+91 98765-43210", "098765 43210", "9876543210" are one person) - the same rule the Contacts module uses.
export const ALREADY_A_WORKER = "Already a Worker";

export const regPhoneKey = (v) => { const k = phoneKey(v); return k && k.length === 10 ? k : null; };

// The live Contact (not a rejected caller submission) with this number, if any.
export async function findContactByPhoneKey(key, db = query) {
  if (!key) return null;
  const notRejected = (await hasApprovalStatusColumn()) ? " AND (approval_status IS NULL OR approval_status <> 'rejected')" : "";
  const rows = await db(`SELECT id, person_name, worker_id FROM contacts WHERE ${last10Sql("phone_number")} = ?${notRejected} ORDER BY id ASC LIMIT 1`, [key]);
  return rows[0] || null;
}

// Is this number already a WORKER? A Worker is: a karyakarta (reg_workers) of this drive, a field Worker
// record (workers table), or a Contact that is linked to a Worker record. Returns a description or null.
// A plain Contact (not a Worker) is NOT a match - registering that person is legitimate and just links.
export async function findExistingWorker(campaignId, key, db = query) {
  if (!key) return null;
  const rw = await db(`SELECT id, name FROM reg_workers WHERE campaign_id = ? AND ${last10Sql("mobile")} = ? LIMIT 1`, [campaignId, key]);
  if (rw[0]) return { kind: "karyakarta", id: rw[0].id, name: rw[0].name };
  const w = await db(`SELECT id, name FROM workers WHERE ${last10Sql("mobile")} = ? LIMIT 1`, [key]);
  if (w[0]) return { kind: "worker", id: w[0].id, name: w[0].name };
  const c = await findContactByPhoneKey(key, db);
  if (c?.worker_id) return { kind: "contact_worker", id: c.worker_id, name: c.person_name, contact_id: c.id };
  return null;
}

// Run `fn(conn)` while holding a named MySQL lock, so concurrent requests for the SAME key serialize
// (the duplicate check and the insert then cannot interleave). Always released.
export async function withNamedLock(name, fn, timeoutSec = 15) {
  const conn = await getPool().getConnection();
  let locked = false;
  try {
    const [[r]] = await conn.query("SELECT GET_LOCK(?, ?) AS ok", [name.slice(0, 60), timeoutSec]);
    if (Number(r?.ok) !== 1) return { busy: true };
    locked = true;
    return { value: await fn(conn) };
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [name.slice(0, 60)]).catch(() => {});
    conn.release();
  }
}
