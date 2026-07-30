// Central contact <-> worker synchronization — one source of truth per person.
//
// A person is one `contacts` row and one `workers` row, linked by the stable
// `contacts.worker_id` id (NOT the phone number, which can be reformatted or
// duplicated). Every function takes an OPEN mysql2 connection so the caller runs
// it inside a transaction with the originating update — the contact/worker edit
// and its mirror commit or roll back together.
//
// Pre-migration fallback: if contacts.worker_id doesn't exist yet, we match on
// the last-10 digits of the phone so the app keeps working until the deploy
// migration (scripts/link-contacts-workers.mjs) runs.

import { computeWorkerStatus } from "@/lib/workerStatus";

const LAST10 = (c) =>
  `RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${c}, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10)`;
const keyOf = (v) => { if (!v) return null; const d = String(v).replace(/\D/g, ""); return d ? d.slice(-10) : null; };

let _linkCol; // cache: does contacts.worker_id exist?
async function hasWorkerLink(conn) {
  if (_linkCol !== undefined) return _linkCol;
  try { const [r] = await conn.query("SHOW COLUMNS FROM contacts LIKE 'worker_id'"); _linkCol = r.length > 0; }
  catch { _linkCol = false; }
  return _linkCol;
}

async function designationNameOf(conn, id) {
  if (!id) return null;
  const [r] = await conn.query("SELECT name FROM designations WHERE id = ? LIMIT 1", [id]);
  return r[0]?.name || null;
}
async function designationIdOf(conn, position) {
  if (!position) return null;
  const first = String(position).split(",")[0].trim();
  if (!first) return null;
  const [r] = await conn.query("SELECT id FROM designations WHERE name = ? LIMIT 1", [first]);
  return r[0]?.id ?? null;
}

// Mirror a contact's current details onto its linked worker (create + link if
// none exists). Returns the worker id.
export async function syncContactToWorker(conn, contactId) {
  const [cr] = await conn.query("SELECT * FROM contacts WHERE id = ?", [contactId]);
  const c = cr[0];
  if (!c) return null;
  const link = await hasWorkerLink(conn);

  let workerId = null;
  if (link && c.worker_id) {
    const [w] = await conn.query("SELECT id FROM workers WHERE id = ?", [c.worker_id]);
    if (w.length) workerId = w[0].id;
  }
  if (!workerId) {
    const k = keyOf(c.phone_number);
    if (k) {
      const [w] = await conn.query(`SELECT id FROM workers WHERE mobile IS NOT NULL AND ${LAST10("mobile")} = ? ORDER BY id LIMIT 1`, [k]);
      if (w.length) workerId = w[0].id;
    }
  }

  const pos = await designationNameOf(conn, c.designation_id);
  if (workerId) {
    // position: overwrite only when the contact carries a designation, so an
    // address-only edit doesn't wipe a worker's existing role.
    await conn.query(
      `UPDATE workers SET name = ?, mobile = ?, address = ?, zone_id = ?, lok_sabha_id = ?,
              district_id = ?, assembly_id = ?, ward_id = ?, booth_id = ?, position = COALESCE(?, position)
        WHERE id = ?`,
      [c.person_name, c.phone_number, c.address, c.zone_id, c.lok_sabha_id, c.district_id, c.assembly_id, c.ward_id, c.booth_id, pos, workerId]
    );
  } else if (c.phone_number) {
    const [res] = await conn.query(
      `INSERT INTO workers (name, mobile, address, position, zone_id, lok_sabha_id, district_id, assembly_id, ward_id, booth_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.person_name, c.phone_number, c.address, pos, c.zone_id, c.lok_sabha_id, c.district_id, c.assembly_id, c.ward_id, c.booth_id]
    );
    workerId = res.insertId;
  }

  if (link && workerId && c.worker_id !== workerId) {
    await conn.query("UPDATE contacts SET worker_id = ? WHERE id = ?", [workerId, contactId]);
  }

  // A contact edit (My Workplace) just changed the worker's profile fields —
  // recompute its Active/Pending status so completeness stays in step.
  if (workerId) {
    const [wr] = await conn.query("SELECT * FROM workers WHERE id = ?", [workerId]);
    if (wr[0]) {
      const st = computeWorkerStatus(wr[0]);
      if (wr[0].status !== st) await conn.query("UPDATE workers SET status = ? WHERE id = ?", [st, workerId]);
    }
  }
  return workerId;
}

// Mirror a worker's current details onto its linked contact (create + link if
// none exists). Returns the contact id.
export async function syncWorkerToContact(conn, workerId) {
  const [wr] = await conn.query("SELECT * FROM workers WHERE id = ?", [workerId]);
  const w = wr[0];
  if (!w) return null;
  const link = await hasWorkerLink(conn);

  let contactId = null;
  if (link) {
    const [c] = await conn.query("SELECT id FROM contacts WHERE worker_id = ? LIMIT 1", [workerId]);
    if (c.length) contactId = c[0].id;
  }
  if (!contactId) {
    const k = keyOf(w.mobile);
    if (k) {
      const [c] = await conn.query(`SELECT id FROM contacts WHERE phone_number IS NOT NULL AND ${LAST10("phone_number")} = ? ORDER BY id LIMIT 1`, [k]);
      if (c.length) contactId = c[0].id;
    }
  }

  const desigId = await designationIdOf(conn, w.position);
  if (contactId) {
    await conn.query(
      `UPDATE contacts SET person_name = ?, phone_number = ?, address = ?, zone_id = ?, lok_sabha_id = ?,
              district_id = ?, assembly_id = ?, ward_id = ?, booth_id = ?, designation_id = COALESCE(?, designation_id)
        WHERE id = ?`,
      [w.name, w.mobile, w.address, w.zone_id, w.lok_sabha_id, w.district_id, w.assembly_id, w.ward_id, w.booth_id, desigId, contactId]
    );
    if (link) await conn.query("UPDATE contacts SET worker_id = ? WHERE id = ? AND (worker_id IS NULL OR worker_id <> ?)", [workerId, contactId, workerId]);
  } else if (w.mobile) {
    try {
      const cols = "person_name, phone_number, address, designation_id, zone_id, lok_sabha_id, district_id, assembly_id, ward_id, booth_id" + (link ? ", worker_id" : "");
      const ph = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?" + (link ? ", ?" : "");
      const vals = [w.name, w.mobile, w.address, desigId, w.zone_id, w.lok_sabha_id, w.district_id, w.assembly_id, w.ward_id, w.booth_id];
      if (link) vals.push(workerId);
      const [res] = await conn.query(`INSERT INTO contacts (${cols}) VALUES (${ph})`, vals);
      contactId = res.insertId;
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        // Contact with this phone already exists (UNIQUE phone_number) → link it.
        const k = keyOf(w.mobile);
        const [c] = await conn.query(`SELECT id FROM contacts WHERE ${LAST10("phone_number")} = ? LIMIT 1`, [k]);
        if (c.length) { contactId = c[0].id; if (link) await conn.query("UPDATE contacts SET worker_id = ? WHERE id = ?", [workerId, contactId]); }
      } else throw e;
    }
  }
  return contactId;
}
