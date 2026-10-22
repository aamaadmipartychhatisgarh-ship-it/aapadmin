import { query, getPool } from "@/lib/db";
import { last10Sql } from "@/lib/phone";
import { normalizeIndianMobile } from "@/lib/phoneLinks";
import { buildHeaderIndex, norm, resolveLoc, DISTRICT_ALIASES, ASSEMBLY_ALIASES } from "@/lib/workerImport";

// Unfiltered Contacts — raw bulk-imported numbers kept in their OWN table,
// logically separate from `contacts` (nothing here reads-for-write or writes the
// contacts table; it is only consulted to skip numbers that are already a
// Contact). Phone Number is the identity: stored normalized to the 10-digit
// Indian mobile (phone_key) with a UNIQUE key, so the same number can never be
// saved twice — not by a repeated upload and not by two concurrent imports.

let ensured = false;
export async function ensureUnfilteredSchema() {
  if (ensured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS unfiltered_contacts (
       id INT AUTO_INCREMENT PRIMARY KEY,
       person_name VARCHAR(255) NULL,
       phone_number VARCHAR(32) NOT NULL,
       phone_key CHAR(10) NOT NULL,
       address TEXT NULL,
       district_name VARCHAR(150) NULL,
       assembly_name VARCHAR(150) NULL,
       district_id INT NULL,
       assembly_id INT NULL,
       designation VARCHAR(255) NULL,
       import_batch_id INT NULL,
       imported_by INT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uq_unfiltered_phone (phone_key),
       KEY idx_unfiltered_batch (import_batch_id),
       KEY idx_unfiltered_created (created_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  await query(
    `CREATE TABLE IF NOT EXISTS unfiltered_import_batches (
       id INT AUTO_INCREMENT PRIMARY KEY,
       file_name VARCHAR(255) NULL,
       total_rows INT NOT NULL DEFAULT 0,
       imported INT NOT NULL DEFAULT 0,
       duplicates INT NOT NULL DEFAULT 0,
       invalid INT NOT NULL DEFAULT 0,
       imported_by INT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  ensured = true;
}

const isBlankRow = (row) => !row || row.every((c) => String(c ?? "").trim() === "");

// Parse the sheet (array-of-arrays, header first) into candidate rows. Every
// non-blank data row lands in exactly ONE bucket, so the summary always adds up:
//   invalid      – Phone Number missing or not a valid 10-digit Indian mobile
//   dup_file     – same normalized number earlier in this file (first one wins)
//   candidates   – to be checked against the database
export async function parseUnfilteredSheet(rows) {
  const headerIdx = buildHeaderIndex(rows[0] || []);
  if (headerIdx.mobile === undefined) {
    return { error: "Could not find a Phone Number column (Phone / Mobile / Contact No) in the sheet." };
  }
  const [districtRows, assemblyRows] = await Promise.all([
    query("SELECT id, name FROM locations WHERE type = 'district'"),
    query("SELECT id, name FROM locations WHERE type = 'assembly'"),
  ]);
  const districtByName = new Map(districtRows.map((r) => [norm(r.name), r.id]));
  const assemblyByName = new Map(assemblyRows.map((r) => [norm(r.name), r.id]));
  const get = (row, f) => (headerIdx[f] !== undefined ? String(row[headerIdx[f]] ?? "").trim() : "");

  const rowErrors = [];
  const candidates = [];
  const seen = new Map(); // phone_key → first row number
  let total = 0, invalid = 0, dupFile = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (isBlankRow(row)) continue;
    total++;
    const rowNum = i + 1;
    const name = get(row, "name");
    const rawPhone = get(row, "mobile");
    const key = normalizeIndianMobile(rawPhone);
    if (!key) {
      invalid++;
      rowErrors.push({ row: rowNum, name, mobile: rawPhone, severity: "error", reasons: [rawPhone ? "Invalid phone number" : "Missing phone number"] });
      continue;
    }
    if (seen.has(key)) {
      dupFile++;
      rowErrors.push({ row: rowNum, name, mobile: rawPhone, severity: "duplicate", reasons: [`Duplicate of row ${seen.get(key)} in this file (same phone)`] });
      continue;
    }
    seen.set(key, rowNum);
    const districtName = get(row, "district");
    const assemblyName = get(row, "assembly");
    candidates.push({
      row: rowNum,
      name: name || null,
      phone: rawPhone,
      key,
      address: get(row, "address") || null,
      districtName: districtName || null,
      assemblyName: assemblyName || null,
      districtId: districtName ? resolveLoc(norm(districtName), districtByName, DISTRICT_ALIASES) : null,
      assemblyId: assemblyName ? resolveLoc(norm(assemblyName), assemblyByName, ASSEMBLY_ALIASES) : null,
      designation: get(row, "designation") || null,
    });
  }
  return { total, invalid, dupFile, candidates, rowErrors };
}

const CHUNK = 500;
const LOCK = "aapadmin_unfiltered_contacts_import";

// Which of `keys` already exist (normalized) in a table — chunked IN lookups.
async function existingKeys(conn, sqlFor, keys) {
  const found = new Set();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const part = keys.slice(i, i + CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const [rows] = await conn.query(sqlFor(part.map(() => "?").join(",")), part);
    for (const r of rows) found.add(String(r.k));
  }
  return found;
}

// Commit an import. Serialized by a named lock so two concurrent imports cannot
// both decide a number is new; the UNIQUE key is the final guard (INSERT IGNORE
// — an existing record is never overwritten). Returns the summary counts.
export async function importUnfiltered({ parsed, fileName, userId }) {
  const { total, invalid, dupFile, candidates, rowErrors } = parsed;
  const conn = await getPool().getConnection();
  let locked = false;
  try {
    const [[lk]] = await conn.query("SELECT GET_LOCK(?, 30) AS ok", [LOCK]);
    if (Number(lk?.ok) !== 1) throw Object.assign(new Error("Another import is in progress. Please try again in a moment."), { status: 409 });
    locked = true;
    await conn.beginTransaction();
    const keys = candidates.map((c) => c.key);
    const inUnfiltered = await existingKeys(conn, (ph) => `SELECT phone_key AS k FROM unfiltered_contacts WHERE phone_key IN (${ph})`, keys);
    const inContacts = await existingKeys(conn, (ph) => `SELECT DISTINCT ${last10Sql("phone_number")} AS k FROM contacts WHERE ${last10Sql("phone_number")} IN (${ph})`, keys);
    let dupUnfiltered = 0, dupContacts = 0;
    const toInsert = [];
    for (const c of candidates) {
      if (inUnfiltered.has(c.key)) { dupUnfiltered++; rowErrors.push({ row: c.row, name: c.name || "", mobile: c.phone, severity: "duplicate", reasons: ["Already in Unfiltered Contacts"] }); }
      else if (inContacts.has(c.key)) { dupContacts++; rowErrors.push({ row: c.row, name: c.name || "", mobile: c.phone, severity: "duplicate", reasons: ["Already in Contacts"] }); }
      else toInsert.push(c);
    }
    const [batch] = await conn.query(
      "INSERT INTO unfiltered_import_batches (file_name, total_rows, imported_by) VALUES (?, ?, ?)",
      [fileName ? String(fileName).slice(0, 255) : null, total, userId || null]
    );
    const batchId = batch.insertId;
    let imported = 0;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const part = toInsert.slice(i, i + CHUNK);
      const vals = [];
      for (const c of part) vals.push(c.name, c.phone, c.key, c.address, c.districtName, c.assemblyName, c.districtId, c.assemblyId, c.designation, batchId, userId || null);
      // eslint-disable-next-line no-await-in-loop
      const [res] = await conn.query(
        `INSERT IGNORE INTO unfiltered_contacts
           (person_name, phone_number, phone_key, address, district_name, assembly_name, district_id, assembly_id, designation, import_batch_id, imported_by)
         VALUES ${part.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",")}`,
        vals
      );
      imported += res.affectedRows || 0;
    }
    // Rows the UNIQUE key refused (only possible in a race) are duplicates too.
    const raceDup = toInsert.length - imported;
    const duplicates = dupFile + dupUnfiltered + dupContacts + raceDup;
    await conn.query("UPDATE unfiltered_import_batches SET imported = ?, duplicates = ?, invalid = ? WHERE id = ?", [imported, duplicates, invalid, batchId]);
    await conn.commit();
    rowErrors.sort((a, b) => a.row - b.row);
    return {
      batch_id: batchId,
      total_rows: total,
      added: imported,
      duplicates,
      duplicates_in_file: dupFile,
      duplicates_unfiltered: dupUnfiltered + raceDup,
      duplicates_contacts: dupContacts,
      invalid,
      row_errors: rowErrors,
    };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [LOCK]).catch(() => {});
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Assigned Calls — Unfiltered Contacts handed to existing CALLER accounts.
// Stored on the unfiltered row itself (one assignee per record, so a number can
// never be with two callers); regular contacts.assigned_to_user_id is never read
// or written here. Completion is recorded by the caller (completed_at/by + the
// existing call_statuses disposition).
// ---------------------------------------------------------------------------
let ensuredAssign = false;
export async function ensureUnfilteredAssignmentSchema() {
  if (ensuredAssign) return;
  await ensureUnfilteredSchema();
  const cols = await query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'unfiltered_contacts'`
  );
  const have = new Set(cols.map((r) => r.c));
  const add = [
    ["assigned_to_user_id", "INT NULL"],
    ["assigned_at", "DATETIME NULL"],
    ["assigned_by", "INT NULL"],
    ["completed_at", "DATETIME NULL"],
    ["completed_by", "INT NULL"],
    ["call_status_id", "INT NULL"],
    ["call_status_name", "VARCHAR(120) NULL"],
    ["call_notes", "TEXT NULL"],
  ].filter(([c]) => !have.has(c));
  for (const [c, def] of add) {
    // eslint-disable-next-line no-await-in-loop
    await query(`ALTER TABLE unfiltered_contacts ADD COLUMN \`${c}\` ${def}`);
  }
  const idx = await query(
    `SELECT INDEX_NAME AS i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'unfiltered_contacts' AND INDEX_NAME = 'idx_unfiltered_assignee'`
  );
  if (!idx.length) await query("ALTER TABLE unfiltered_contacts ADD INDEX idx_unfiltered_assignee (assigned_to_user_id, completed_at)");
  ensuredAssign = true;
}

// Eligible callers = existing, enabled CALLER accounts (no accounts are created).
const ELIGIBLE_CALLERS_SQL = "SELECT id, username FROM users WHERE role = 'caller' AND is_active = 1";

// A number that has since become a regular Contact is no longer callable here.
// (NOT IN over a non-correlated subquery is materialized once; NULL phones are
// excluded so NOT IN can never collapse to NULL.)
const NOT_IN_CONTACTS = (alias) =>
  `${alias}.phone_key NOT IN (SELECT ${last10Sql("ct.phone_number")} FROM contacts ct WHERE ct.phone_number IS NOT NULL AND ct.phone_number <> '')`;
// Pending records whose assignee is no longer an enabled caller are the only
// existing assignments eligible for reassignment.
const ASSIGNEE_INELIGIBLE = (alias) =>
  `${alias}.assigned_to_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users ua WHERE ua.id = ${alias}.assigned_to_user_id AND ua.role = 'caller' AND ua.is_active = 1)`;
// The assignment pool: not completed, still not a Contact, and either
// unassigned or held by an ineligible (disabled / non-caller) account.
const POOL_WHERE = (alias) =>
  `${alias}.completed_at IS NULL AND ${NOT_IN_CONTACTS(alias)} AND (${alias}.assigned_to_user_id IS NULL OR (${ASSIGNEE_INELIGIBLE(alias)}))`;

export async function unfilteredAssignmentOverview() {
  await ensureUnfilteredAssignmentSchema();
  const [[t], callers, rows] = await Promise.all([
    query(
      `SELECT COUNT(*) AS total,
              SUM(u.completed_at IS NOT NULL) AS completed,
              SUM(u.completed_at IS NULL AND ${NOT_IN_CONTACTS("u")}) AS callable,
              SUM(${POOL_WHERE("u")}) AS available,
              SUM(u.completed_at IS NULL AND ${NOT_IN_CONTACTS("u")} AND u.assigned_to_user_id IS NOT NULL AND (${ASSIGNEE_INELIGIBLE("u")})) AS reassignable,
              SUM(u.completed_at IS NULL AND NOT (${NOT_IN_CONTACTS("u")})) AS now_contacts
         FROM unfiltered_contacts u`
    ),
    query(`${ELIGIBLE_CALLERS_SQL} ORDER BY username`),
    query(
      `SELECT u.assigned_to_user_id AS user_id, us.username, us.role, us.is_active,
              COUNT(*) AS assigned, SUM(u.completed_at IS NOT NULL) AS completed, SUM(u.completed_at IS NULL) AS pending
         FROM unfiltered_contacts u LEFT JOIN users us ON us.id = u.assigned_to_user_id
        WHERE u.assigned_to_user_id IS NOT NULL
        GROUP BY u.assigned_to_user_id, us.username, us.role, us.is_active`
    ),
  ]);
  const byId = new Map(rows.map((r) => [Number(r.user_id), r]));
  const n = (v) => Number(v || 0);
  // Every eligible caller (zero rows included), then any other account that
  // still holds records (e.g. a disabled caller) so the totals always add up.
  const summary = callers.map((c) => {
    const r = byId.get(Number(c.id));
    return { user_id: c.id, caller_name: c.username, eligible: true, assigned: n(r?.assigned), completed: n(r?.completed), pending: n(r?.pending) };
  });
  for (const r of rows) {
    if (callers.some((c) => Number(c.id) === Number(r.user_id))) continue;
    summary.push({ user_id: r.user_id, caller_name: r.username || `User #${r.user_id}`, eligible: false, assigned: n(r.assigned), completed: n(r.completed), pending: n(r.pending) });
  }
  return {
    total: n(t.total),
    callable: n(t.callable),
    available: n(t.available),
    reassignable: n(t.reassignable),
    completed: n(t.completed),
    now_contacts: n(t.now_contacts),
    eligible_callers: callers.length,
    callers: summary,
  };
}

// Evenly Distribute: hand the whole pool to the eligible callers so this round's
// counts differ by at most one; the remainder goes to the callers with the
// fewest pending calls. One distribution at a time (named lock) inside a
// transaction with the pool rows locked, and every UPDATE re-checks the pool
// condition — a second click (or a concurrent request) finds nothing left and
// assigns 0, never a duplicate.
const DIST_LOCK = "aapadmin_unfiltered_distribute";
export async function distributeUnfiltered({ byUserId }) {
  await ensureUnfilteredAssignmentSchema();
  const conn = await getPool().getConnection();
  let locked = false;
  try {
    const [[lk]] = await conn.query("SELECT GET_LOCK(?, 30) AS ok", [DIST_LOCK]);
    if (Number(lk?.ok) !== 1) throw Object.assign(new Error("A distribution is already running. Please try again in a moment."), { status: 409 });
    locked = true;
    await conn.beginTransaction();
    const [callers] = await conn.query(
      `SELECT us.id, us.username,
              (SELECT COUNT(*) FROM unfiltered_contacts x WHERE x.assigned_to_user_id = us.id AND x.completed_at IS NULL) AS pending
         FROM users us WHERE us.role = 'caller' AND us.is_active = 1
        ORDER BY pending ASC, us.id ASC`
    );
    if (!callers.length) throw Object.assign(new Error("No active caller accounts to distribute to."), { status: 400 });
    const [poolRows] = await conn.query(`SELECT u.id FROM unfiltered_contacts u WHERE ${POOL_WHERE("u")} ORDER BY u.id ASC FOR UPDATE`);
    const ids = poolRows.map((r) => r.id);
    const k = callers.length;
    const base = Math.floor(ids.length / k);
    const rem = ids.length % k;
    const perCaller = [];
    let at = 0;
    let assigned = 0;
    for (let i = 0; i < k; i++) {
      const take = base + (i < rem ? 1 : 0);
      const part = ids.slice(at, at + take);
      at += take;
      let done = 0;
      for (let j = 0; j < part.length; j += CHUNK) {
        const chunk = part.slice(j, j + CHUNK);
        // eslint-disable-next-line no-await-in-loop
        const [res] = await conn.query(
          `UPDATE unfiltered_contacts u SET u.assigned_to_user_id = ?, u.assigned_at = NOW(), u.assigned_by = ?
            WHERE u.id IN (${chunk.map(() => "?").join(",")}) AND ${POOL_WHERE("u")}`,
          [callers[i].id, byUserId || null, ...chunk]
        );
        done += res.affectedRows || 0;
      }
      assigned += done;
      perCaller.push({ user_id: callers[i].id, caller_name: callers[i].username, assigned_now: done });
    }
    await conn.commit();
    return { pool: ids.length, assigned, callers: k, per_caller: perCaller };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [DIST_LOCK]).catch(() => {});
    conn.release();
  }
}

// Caller side: the caller's own assigned Unfiltered Calls.
export async function myUnfilteredCalls(userId, { view = "pending" } = {}) {
  await ensureUnfilteredAssignmentSchema();
  const cond = view === "completed" ? "u.completed_at IS NOT NULL" : view === "all" ? "1=1" : "u.completed_at IS NULL";
  const rows = await query(
    `SELECT u.id, u.person_name, u.phone_number, u.phone_key, u.address, u.designation,
            COALESCE(ld.name, u.district_name) AS district, COALESCE(la.name, u.assembly_name) AS assembly,
            u.assigned_at, u.completed_at, u.call_status_name, u.call_notes
       FROM unfiltered_contacts u
       LEFT JOIN locations ld ON ld.id = u.district_id
       LEFT JOIN locations la ON la.id = u.assembly_id
      WHERE u.assigned_to_user_id = ? AND ${cond}
      ORDER BY ${view === "completed" ? "u.completed_at DESC" : "u.assigned_at ASC, u.id ASC"}
      LIMIT 500`,
    [userId]
  );
  const [c] = await query(
    `SELECT COUNT(*) AS assigned, SUM(completed_at IS NOT NULL) AS completed, SUM(completed_at IS NULL) AS pending
       FROM unfiltered_contacts WHERE assigned_to_user_id = ?`,
    [userId]
  );
  return { calls: rows, counts: { assigned: Number(c?.assigned || 0), completed: Number(c?.completed || 0), pending: Number(c?.pending || 0) } };
}

// Mark one of the caller's own calls completed with an existing call status.
// Only the assignee can complete it, and only once (the WHERE re-checks both),
// so a double-click or a stale tab can't complete it twice or for someone else.
export async function completeUnfilteredCall({ id, userId, statusId, notes }) {
  await ensureUnfilteredAssignmentSchema();
  const [st] = await query("SELECT id, name FROM call_statuses WHERE id = ?", [Number(statusId) || 0]);
  if (!st) return { status: 400, message: "Choose a call status." };
  const res = await query(
    `UPDATE unfiltered_contacts SET completed_at = NOW(), completed_by = ?, call_status_id = ?, call_status_name = ?, call_notes = ?
      WHERE id = ? AND assigned_to_user_id = ? AND completed_at IS NULL`,
    [userId, st.id, st.name, notes ? String(notes).slice(0, 2000) : null, Number(id) || 0, userId]
  );
  if (res.affectedRows === 1) return { status: 200, message: "Call completed." };
  const [row] = await query("SELECT assigned_to_user_id, completed_at FROM unfiltered_contacts WHERE id = ?", [Number(id) || 0]);
  if (!row || Number(row.assigned_to_user_id) !== Number(userId)) return { status: 404, message: "This call is not assigned to you." };
  return { status: 409, message: "This call is already completed." };
}
