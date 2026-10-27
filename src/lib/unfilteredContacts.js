import { query, getPool } from "@/lib/db";
import { last10Sql } from "@/lib/phone";
import { normalizeIndianMobile } from "@/lib/phoneLinks";
import { buildHeaderIndex, norm, resolveLoc, DISTRICT_ALIASES, ASSEMBLY_ALIASES } from "@/lib/workerImport";
import { syncContactDesignations } from "@/lib/contactDesignations";
import { hasApprovalStatusColumn } from "@/lib/contactExtras";
import { photoForGeneralEdit } from "@/lib/contactPhotoUrl";
import { addressForGeneralEdit } from "@/lib/contactAddress";
import { resolveOrCreateWard } from "@/lib/contactLocation";
import { releaseOutOfZoneAssignment } from "@/lib/contactZone";
import { logAudit } from "@/lib/audit";

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
// Both sides get one explicit collation: contacts and unfiltered_contacts may
// have different table collations on a deployment (cross-table string
// comparison would otherwise fail with "Illegal mix of collations").
const KEY_COLL = "utf8mb4_unicode_ci";
const NOT_IN_CONTACTS = (alias) =>
  `CONVERT(${alias}.phone_key USING utf8mb4) COLLATE ${KEY_COLL} NOT IN (SELECT CONVERT(${last10Sql("ct.phone_number")} USING utf8mb4) COLLATE ${KEY_COLL} FROM contacts ct WHERE ct.phone_number IS NOT NULL AND ct.phone_number <> '')`;
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
// `limit` (optional, a positive whole number) assigns UP TO that many pool calls instead of the whole pool -
// the same locked, re-checked mechanism, just a capped selection (lowest ids first); fewer available than
// requested is not an error - the available ones are assigned and the result says so. `callerId` (optional)
// hands the calls to that one active caller instead of sharing them evenly. The result carries the real
// requested / assigned / remaining numbers, counted from the database after the commit.
export async function distributeUnfiltered({ byUserId, limit = null, callerId = null }) {
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
         FROM users us WHERE us.role = 'caller' AND us.is_active = 1${callerId ? " AND us.id = ?" : ""}
        ORDER BY pending ASC, us.id ASC`,
      callerId ? [Number(callerId)] : []
    );
    if (!callers.length) throw Object.assign(new Error(callerId ? "That caller is not an active caller account." : "No active caller accounts to distribute to."), { status: 400 });
    const capSql = limit ? ` LIMIT ${Math.floor(Number(limit))}` : "";
    const [poolRows] = await conn.query(`SELECT u.id FROM unfiltered_contacts u WHERE ${POOL_WHERE("u")} ORDER BY u.id ASC${capSql} FOR UPDATE`);
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
    const [[remRow]] = await conn.query(`SELECT COUNT(*) AS n FROM unfiltered_contacts u WHERE ${POOL_WHERE("u")}`);
    return { pool: ids.length, assigned, callers: k, per_caller: perCaller, requested: limit ? Math.floor(Number(limit)) : null, remaining: Number(remRow?.n || 0) };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [DIST_LOCK]).catch(() => {});
    conn.release();
  }
}

// Caller side: the caller's own assigned Unfiltered Calls.
export async function myUnfilteredCalls(userId, { view = "pending", onlyId = null } = {}) {
  await ensureUnfilteredCallLogSchema();
  let cond = view === "completed" ? "u.completed_at IS NOT NULL" : view === "all" ? "1=1" : "u.completed_at IS NULL";
  if (onlyId) cond = `u.id = ${Number(onlyId) || 0}`;
  const rows = await query(
    `SELECT u.id, u.person_name, u.phone_number, u.phone_key, u.address, u.designation,
            COALESCE(ld.name, u.district_name) AS district, COALESCE(la.name, u.assembly_name) AS assembly,
            u.photo_url, u.zone_id, u.lok_sabha_id, u.district_id, u.assembly_id, u.ward_id, u.contact_id,
            lz.name AS zone_name, lls.name AS lok_sabha_name, lw.name AS ward_name,
            u.assigned_at, u.completed_at, u.call_status_name, u.call_notes,
            (SELECT COUNT(*) FROM unfiltered_call_logs l WHERE l.unfiltered_contact_id = u.id) AS attempts
       FROM unfiltered_contacts u
       LEFT JOIN locations ld ON ld.id = u.district_id
       LEFT JOIN locations la ON la.id = u.assembly_id
       LEFT JOIN locations lz ON lz.id = u.zone_id
       LEFT JOIN locations lls ON lls.id = u.lok_sabha_id
       LEFT JOIN locations lw ON lw.id = u.ward_id
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

// ---------------------------------------------------------------------------
// Unfiltered call records — every disposition a caller logs from My Workspace
// (Unfiltered Calls) is saved here against the UNFILTERED contact. Kept apart
// from the regular `calls` table, so the two call types never mix.
// ---------------------------------------------------------------------------
let ensuredLogs = false;
export async function ensureUnfilteredCallLogSchema() {
  if (ensuredLogs) return;
  await ensureUnfilteredAssignmentSchema();
  await query(
    `CREATE TABLE IF NOT EXISTS unfiltered_call_logs (
       id INT AUTO_INCREMENT PRIMARY KEY,
       unfiltered_contact_id INT NOT NULL,
       caller_id INT NOT NULL,
       logged_by INT NULL,
       status_id INT NULL,
       status_name VARCHAR(120) NULL,
       remarks TEXT NULL,
       duration_seconds INT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       KEY idx_ucl_contact (unfiltered_contact_id),
       KEY idx_ucl_caller (caller_id, created_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  await ensureUnfilteredContactLinkSchema();
  ensuredLogs = true;
}

// ---------------------------------------------------------------------------
// Unfiltered Call -> Contact List link. A Positive / Supporter outcome puts the person into the
// Contact List automatically (see syncUnfilteredToContact). The relationship is stored both ways:
//   contacts.source / contacts.source_unfiltered_contact_id   (UNIQUE: one contact per record)
//   unfiltered_contacts.contact_id / contact_synced_at / call_sentiment
//   unfiltered_call_logs.sentiment
// ---------------------------------------------------------------------------
export const UNFILTERED_SOURCE = "unfiltered_calls";
export const CONTACT_SENTIMENTS = ["positive", "supporter"]; // outcomes that create / update a Contact
export const UNFILTERED_SENTIMENTS = ["positive", "supporter", "neutral", "negative", "opponent", "not_supporter", "wrong_number"];
const SENTIMENT_LABEL = { positive: "Positive", supporter: "Supporter", neutral: "Neutral", negative: "Negative", opponent: "Opponent", not_supporter: "Not a Supporter", wrong_number: "Wrong Number" };

let linkEnsured = false;
export async function ensureUnfilteredContactLinkSchema() {
  if (linkEnsured) return;
  const cols = async (t) => new Set((await query("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [t])).map((r) => r.c));
  const add = async (t, have, name, def) => {
    if (have.has(name)) return;
    try { await query(`ALTER TABLE \`${t}\` ADD COLUMN \`${name}\` ${def}`); } catch (e) { if (!/duplicate column/i.test(e?.message || "")) throw e; }
  };
  let c = await cols("contacts");
  await add("contacts", c, "source", "VARCHAR(40) NULL");
  await add("contacts", c, "source_unfiltered_contact_id", "INT NULL");
  const idx = await query("SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND INDEX_NAME = 'uq_contacts_source_unfiltered' LIMIT 1");
  if (!idx.length) {
    try { await query("ALTER TABLE contacts ADD UNIQUE KEY uq_contacts_source_unfiltered (source_unfiltered_contact_id)"); } catch (e) { if (!/duplicate key name/i.test(e?.message || "")) throw e; }
  }
  c = await cols("unfiltered_contacts");
  await add("unfiltered_contacts", c, "contact_id", "INT NULL");
  await add("unfiltered_contacts", c, "contact_synced_at", "DATETIME NULL");
  await add("unfiltered_contacts", c, "call_sentiment", "VARCHAR(30) NULL");
  // details a caller can edit from My Workspace (same set as a regular call's edit form)
  await add("unfiltered_contacts", c, "photo_url", "VARCHAR(255) NULL");
  await add("unfiltered_contacts", c, "zone_id", "INT NULL");
  await add("unfiltered_contacts", c, "lok_sabha_id", "INT NULL");
  await add("unfiltered_contacts", c, "ward_id", "INT NULL");
  c = await cols("unfiltered_call_logs");
  await add("unfiltered_call_logs", c, "sentiment", "VARCHAR(30) NULL");
  linkEnsured = true;
}

// Create or update the Contact List record for an Unfiltered Contact, on a connection that is already
// inside a transaction holding the unfiltered row's lock (so repeated / concurrent calls serialize).
//   - already linked                                     -> that contact is updated
//   - a Contact with the same number (any format) exists -> THAT record is updated, never a duplicate
//   - otherwise                                          -> a new Contact is created
// Updates only FILL blanks (and note the outcome in remarks): an existing value is never overwritten
// by the carried-forward data. The contact is linked both ways and recorded as sourced from Unfiltered
// Calls (a contact that already has another source keeps it). Returns
// { action: "created" | "updated" | "skipped", contact_id?, reason? }.
export async function syncUnfilteredToContact(conn, row, { sentiment, userId }) {
  const name = String(row.person_name || "").trim();
  const phone = String(row.phone_key || "").trim();
  if (!phone) return { action: "skipped", reason: "no phone number" };
  const [colRows] = await conn.query("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'");
  const have = new Set(colRows.map((r) => r.c));
  const label = SENTIMENT_LABEL[sentiment] || sentiment;
  const note = `Unfiltered Call #${row.id}: ${label} (${new Date().toISOString().slice(0, 10)})`;
  const noteKey = `Unfiltered Call #${row.id}:`;

  // 1. the contact this record is already linked to, else a live contact with the same number
  let existing = null;
  if (row.contact_id) { const [[x]] = await conn.query("SELECT * FROM contacts WHERE id = ?", [row.contact_id]); existing = x || null; }
  if (!existing) { const [[x]] = await conn.query("SELECT * FROM contacts WHERE source_unfiltered_contact_id = ? LIMIT 1", [row.id]); existing = x || null; }
  if (!existing) {
    const notRejected = (await hasApprovalStatusColumn()) ? " AND (approval_status IS NULL OR approval_status <> 'rejected')" : "";
    const [[x]] = await conn.query(`SELECT * FROM contacts WHERE ${last10Sql("phone_number")} = ?${notRejected} ORDER BY id ASC LIMIT 1`, [phone]);
    existing = x || null;
  }

  // 2. carried-forward details
  let desig = null;
  if (row.designation) {
    const [[d]] = await conn.query("SELECT id FROM designations WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1", [row.designation]);
    desig = d || null;
  }
  const extraNote = row.designation && !desig ? ` | Designation (not in master): ${row.designation}` : "";

  if (existing) {
    const sets = [], vals = [];
    const fill = (col, v) => {
      if (have.has(col) && v != null && String(v).trim() !== "" && (existing[col] == null || String(existing[col]).trim() === "")) { sets.push(`${col} = ?`); vals.push(v); }
    };
    fill("person_name", name || null);
    fill("address", row.address ? String(row.address).trim() : null);
    fill("district_id", row.district_id || null);
    fill("assembly_id", row.assembly_id || null);
    fill("photo_url", row.photo_url || null);
    fill("zone_id", row.zone_id || null);
    fill("lok_sabha_id", row.lok_sabha_id || null);
    fill("ward_id", row.ward_id || null);
    fill("designation_id", desig?.id || null);
    if (have.has("source_unfiltered_contact_id") && existing.source_unfiltered_contact_id == null) { sets.push("source_unfiltered_contact_id = ?"); vals.push(row.id); }
    if (have.has("source") && !String(existing.source || "").trim()) { sets.push("source = ?"); vals.push(UNFILTERED_SOURCE); }
    if (have.has("remarks") && !String(existing.remarks || "").includes(noteKey)) {
      sets.push("remarks = ?");
      vals.push(existing.remarks ? `${String(existing.remarks).trimEnd()}\n${note}${extraNote}` : `${note}${extraNote}`);
    }
    if (sets.length && have.has("updated_at")) sets.push("updated_at = NOW()");
    if (sets.length) await conn.query(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, [...vals, existing.id]);
    if (desig?.id && !existing.designation_id) {
      const [[has]] = await conn.query("SELECT COUNT(*) AS n FROM contact_designations WHERE contact_id = ?", [existing.id]);
      if (!Number(has.n)) await syncContactDesignations(existing.id, [desig.id]).catch(() => {});
    }
    await conn.query("UPDATE unfiltered_contacts SET contact_id = ?, contact_synced_at = NOW() WHERE id = ?", [existing.id, row.id]);
    return { action: "updated", contact_id: existing.id };
  }

  // 3. no contact yet: create one (name + number are mandatory - never an incomplete Contact)
  if (!name) return { action: "skipped", reason: "the Unfiltered record has no name" };
  const desired = {
    person_name: name, phone_number: phone, address: row.address ? String(row.address).trim() : null,
    district_id: row.district_id || null, assembly_id: row.assembly_id || null,
    photo_url: row.photo_url || null, zone_id: row.zone_id || null, lok_sabha_id: row.lok_sabha_id || null, ward_id: row.ward_id || null,
    designation_id: desig?.id || null,
    remarks: `${note}${extraNote}`,
    created_by_user_id: userId || null,
    source: UNFILTERED_SOURCE, source_unfiltered_contact_id: row.id,
  };
  const cols = Object.keys(desired).filter((k) => have.has(k));
  let contactId;
  try {
    const [ins] = await conn.query(`INSERT INTO contacts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((k) => desired[k]));
    contactId = ins.insertId;
  } catch (e) {
    if (e?.code !== "ER_DUP_ENTRY") throw e;
    // the same number (or this record's link) was saved a moment ago by someone else: use that one
    const [[x]] = await conn.query(`SELECT id FROM contacts WHERE source_unfiltered_contact_id = ? OR ${last10Sql("phone_number")} = ? ORDER BY id ASC LIMIT 1`, [row.id, phone]);
    if (!x) throw e;
    await conn.query("UPDATE unfiltered_contacts SET contact_id = ?, contact_synced_at = NOW() WHERE id = ?", [x.id, row.id]);
    return { action: "updated", contact_id: x.id };
  }
  if (desig?.id) await syncContactDesignations(contactId, [desig.id]).catch(() => {});
  await conn.query("UPDATE unfiltered_contacts SET contact_id = ?, contact_synced_at = NOW() WHERE id = ?", [contactId, row.id]);
  return { action: "created", contact_id: contactId };
}


// Same completion rule as a regular call (api/calls): these outcomes finish the
// contact; any other status (Not Picked, Busy, Switched Off…) is an attempt and
// the call stays pending for a retry.
export const UNFILTERED_FINAL_STATUSES = ["Phone Picked", "Wrong Number", "Rudely Behaved"];

// Log a disposition for one of the acting caller's OWN pending Unfiltered Calls.
// The row is locked for the check + write, so it can't be logged against
// someone else's record, after completion, or completed twice.
export async function logUnfilteredCall({ id, callerId, loggedBy, statusId, remarks, durationSeconds, sentiment }) {
  await ensureUnfilteredCallLogSchema();
  const [st] = await query("SELECT id, name FROM call_statuses WHERE id = ?", [Number(statusId) || 0]);
  if (!st) return { status: 400, message: "Please pick a status." };
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query("SELECT * FROM unfiltered_contacts WHERE id = ? FOR UPDATE", [Number(id) || 0]);
    if (!row || Number(row.assigned_to_user_id) !== Number(callerId)) { await conn.rollback(); return { status: 404, message: "This call is not assigned to you." }; }
    if (row.completed_at) { await conn.rollback(); return { status: 409, message: "This call is already completed." }; }
    const notes = remarks ? String(remarks).slice(0, 2000) : null;
    const dur = Math.max(0, Math.min(86400, Math.round(Number(durationSeconds) || 0)));
    // Sentiment only applies to a connected ("Phone Picked") call, as in a regular call.
    const sent = st.name === "Phone Picked" && UNFILTERED_SENTIMENTS.includes(String(sentiment || "")) ? String(sentiment) : null;
    const [ins] = await conn.query(
      `INSERT INTO unfiltered_call_logs (unfiltered_contact_id, caller_id, logged_by, status_id, status_name, remarks, duration_seconds, sentiment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, callerId, loggedBy || callerId, st.id, st.name, notes, dur, sent]
    );
    const final = UNFILTERED_FINAL_STATUSES.includes(st.name);
    await conn.query(
      `UPDATE unfiltered_contacts
          SET call_status_id = ?, call_status_name = ?, call_notes = ?, call_sentiment = ?,
              completed_at = CASE WHEN ? THEN NOW() ELSE NULL END,
              completed_by = CASE WHEN ? THEN ? ELSE NULL END
        WHERE id = ?`,
      [st.id, st.name, notes, sent, final ? 1 : 0, final ? 1 : 0, callerId, row.id]
    );
    // Positive / Supporter -> create or update the Contact List record, in the SAME transaction as the
    // log (both saved or neither), serialized by the row lock above.
    let sync = null;
    if (sent && CONTACT_SENTIMENTS.includes(sent)) sync = await syncUnfilteredToContact(conn, row, { sentiment: sent, userId: callerId });
    await conn.commit();
    const syncMsg = sync?.action === "created" ? " Added to the Contact List." : sync?.action === "updated" ? " Contact List record updated." : sync?.action === "skipped" ? ` Not added to the Contact List (${sync.reason}).` : "";
    return { status: 200, message: (final ? "Saved — call completed." : "Saved — kept pending for a retry.") + syncMsg, completed: final, log_id: ins.insertId, contact_sync: sync };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// Previous attempts on one Unfiltered Contact — only for its assigned caller.
export async function unfilteredCallHistory({ id, callerId }) {
  await ensureUnfilteredCallLogSchema();
  const [row] = await query("SELECT assigned_to_user_id FROM unfiltered_contacts WHERE id = ?", [Number(id) || 0]);
  if (!row || Number(row.assigned_to_user_id) !== Number(callerId)) return null;
  return query(
    `SELECT l.id, l.status_name, l.sentiment, l.remarks, l.duration_seconds, l.created_at, us.username AS agent_name
       FROM unfiltered_call_logs l LEFT JOIN users us ON us.id = l.caller_id
      WHERE l.unfiltered_contact_id = ? ORDER BY l.id DESC`,
    [Number(id)]
  );
}


// ---------------------------------------------------------------------------
// Edit an Unfiltered Call's details from My Workspace (Photo, Address, Zone, Lok Sabha, District,
// Assembly, Block) - the same fields, and the same stale-form protection, as a regular call's edit.
// Only the ASSIGNED caller may edit. The edit form is a snapshot, so only deliberately changed
// fields are written (address_prev / photo_url_prev / geo_prev baselines); blanks never clear a
// value, and only managers (canClear) may remove an address. When the record is already linked to
// a Contact List record the same changes are applied to THAT contact (never a new one).
// ---------------------------------------------------------------------------
const GEO_KEYS = ["zone_id", "lok_sabha_id", "district_id", "assembly_id"];
const GEO_TYPE = { zone_id: "zone", lok_sabha_id: "lok_sabha", district_id: "district", assembly_id: "assembly" };
const idOrNull = (v) => (v == null || String(v).trim() === "" ? null : Number(v));

export async function updateUnfilteredContact({ session, id, callerId, data, canClear = false }) {
  await ensureUnfilteredCallLogSchema();
  data = data && typeof data === "object" ? data : {};
  const conn = await getPool().getConnection();
  let zoneChanged = null;
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query("SELECT * FROM unfiltered_contacts WHERE id = ? FOR UPDATE", [Number(id) || 0]);
    if (!row || Number(row.assigned_to_user_id) !== Number(callerId)) { await conn.rollback(); return { status: 404, message: "This call is not assigned to you." }; }

    const sets = {};
    const flags = {};
    const ad = addressForGeneralEdit(data, row.address, canClear);
    if (ad.conflict) flags.address_conflict = true;
    if ("value" in ad) sets.address = ad.value;
    const ph = await photoForGeneralEdit(data, row.photo_url);
    if (ph.ignored) flags.photo_ignored = true;
    if (ph.set) sets.photo_url = ph.set;

    // Geography: only fields whose value differs from the form's baseline (or, with no baseline, the record)
    const prev = data.geo_prev && typeof data.geo_prev === "object" ? data.geo_prev : null;
    const next = {};
    for (const k of GEO_KEYS) {
      if (!(k in data)) continue;
      const want = idOrNull(data[k]);
      if (want == null) continue;                   // a blank never clears
      const base = prev && k in prev ? idOrNull(prev[k]) : idOrNull(row[k]);
      if (want === base) continue;                  // the user did not edit it
      if (!Number.isInteger(want) || want <= 0) { await conn.rollback(); return { status: 400, message: "Invalid location selected." }; }
      if (want === idOrNull(row[k])) continue;      // already stored
      next[k] = want;
    }
    for (const k of Object.keys(next)) {
      const [[loc]] = await conn.query("SELECT type FROM locations WHERE id = ?", [next[k]]);
      if (!loc || loc.type !== GEO_TYPE[k]) { await conn.rollback(); return { status: 400, message: `Invalid ${GEO_TYPE[k].replace("_", " ")} selected.` }; }
    }
    const finalDistrict = next.district_id ?? row.district_id;
    const finalAssembly = next.assembly_id ?? row.assembly_id;
    if ((next.assembly_id || next.district_id) && finalAssembly && finalDistrict) {
      const [[a]] = await conn.query("SELECT parent_id FROM locations WHERE id = ?", [finalAssembly]);
      if (!a || Number(a.parent_id) !== Number(finalDistrict)) { await conn.rollback(); return { status: 400, message: "The Assembly does not belong to the selected District. Please choose an Assembly of that District." }; }
    }
    Object.assign(sets, next);
    if ("district_id" in next) { const [[d]] = await conn.query("SELECT name FROM locations WHERE id = ?", [next.district_id]); sets.district_name = d?.name || null; }
    if ("assembly_id" in next) { const [[a]] = await conn.query("SELECT name FROM locations WHERE id = ?", [next.assembly_id]); sets.assembly_name = a?.name || null; }

    // Block: free text stored as a ward location under the Assembly. A blank never clears it.
    let curWardName = null;
    if (row.ward_id) { const [[w]] = await conn.query("SELECT name FROM locations WHERE id = ?", [row.ward_id]); curWardName = w?.name || null; }
    if ("ward_name" in data) {
      const want = String(data.ward_name ?? "").trim();
      const baseName = "ward_prev" in data ? String(data.ward_prev ?? "").trim() : String(curWardName || "").trim();
      if (want.length > 150) { await conn.rollback(); return { status: 400, message: "Block name is too long." }; }
      if (want && want.toLowerCase() !== baseName.toLowerCase() && want.toLowerCase() !== String(curWardName || "").trim().toLowerCase()) {
        sets.ward_id = await resolveOrCreateWard(want, finalAssembly || null);
      }
    }
    // The Assembly moved but the Block was not edited: keep the same Block name under the new Assembly
    if (next.assembly_id && !("ward_id" in sets) && curWardName) sets.ward_id = await resolveOrCreateWard(curWardName, next.assembly_id);

    const cols = Object.keys(sets);
    if (!cols.length) {
      await conn.commit();
      return { status: 200, message: "No changes to save.", no_change: true, ...flags, record: (await myUnfilteredCalls(callerId, { view: "all", onlyId: row.id })).calls[0] || null };
    }
    await conn.query(`UPDATE unfiltered_contacts SET ${cols.map((c) => `\`${c}\` = ?`).join(", ")} WHERE id = ?`, [...cols.map((c) => sets[c]), row.id]);

    // The same changes onto the linked Contact List record (never a new record)
    let linkedId = row.contact_id || null;
    if (!linkedId) { const [[x]] = await conn.query("SELECT id FROM contacts WHERE source_unfiltered_contact_id = ? LIMIT 1", [row.id]); linkedId = x?.id || null; }
    if (linkedId) {
      const cset = {};
      for (const k of ["address", "photo_url", "zone_id", "lok_sabha_id", "district_id", "assembly_id", "ward_id"]) if (k in sets) cset[k] = sets[k];
      const ck = Object.keys(cset);
      if (ck.length) {
        await conn.query(`UPDATE contacts SET ${ck.map((c) => `\`${c}\` = ?`).join(", ")} WHERE id = ?`, [...ck.map((c) => cset[c]), linkedId]);
        if ("zone_id" in cset) zoneChanged = { contactId: linkedId, zoneId: cset.zone_id };
      }
    }
    await conn.commit();
    if (zoneChanged) await releaseOutOfZoneAssignment(session, zoneChanged.contactId, zoneChanged.zoneId).catch(() => {});
    logAudit(session, { action: "unfiltered.update", entityType: "unfiltered_contact", entityId: String(row.id), details: `Edited ${cols.join(", ")}${linkedId ? ` (contact #${linkedId})` : ""}` });
    return { status: 200, message: "Saved.", ...flags, record: (await myUnfilteredCalls(callerId, { view: "all", onlyId: row.id })).calls[0] || null };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// Remove the Caller -> Unfiltered Contact assignment. Only the three assignment columns are cleared;
// the contact, its details (photo, address, designation, geography, Block), its linked Contact, and
// every call log / completion record are left exactly as they are. The row is locked for the check
// + write, and `expectedCallerId` (the mapping the admin selected) must still be the current one.
export async function removeUnfilteredAssignment({ id, expectedCallerId = null }) {
  await ensureUnfilteredCallLogSchema();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query("SELECT id, assigned_to_user_id, completed_at FROM unfiltered_contacts WHERE id = ? FOR UPDATE", [Number(id) || 0]);
    if (!row) { await conn.rollback(); return { status: 404, message: "Unfiltered contact not found." }; }
    if (row.assigned_to_user_id == null) { await conn.rollback(); return { status: 409, message: "This contact is not assigned to any caller." }; }
    if (expectedCallerId && Number(row.assigned_to_user_id) !== Number(expectedCallerId)) {
      await conn.rollback();
      return { status: 409, message: "This contact is now assigned to a different caller. Please refresh and try again." };
    }
    await conn.query("UPDATE unfiltered_contacts SET assigned_to_user_id = NULL, assigned_at = NULL, assigned_by = NULL WHERE id = ?", [row.id]);
    await conn.commit();
    return { status: 200, message: "Assignment removed.", removed_caller_id: row.assigned_to_user_id, was_completed: !!row.completed_at };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// Assign (or reassign) ONE Unfiltered Contact to a selected, active Caller. The assignee is a single
// column on the row, so a contact can only ever be mapped to one caller - repeating the operation
// (same caller) is a no-op, and a reassignment replaces the previous caller in the same locked
// write (the old caller's list loses it immediately). Only the assignment columns change: the
// contact's details, its linked Contact and the call history (kept against the callers who made the
// calls) are untouched. `expectedCallerId` (optional) guards against a stale screen: it must still
// be the current assignee (use 0 for "expected unassigned").
export async function assignUnfilteredToCaller({ id, callerId, expectedCallerId = undefined, byUserId = null }) {
  await ensureUnfilteredCallLogSchema();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [[caller]] = await conn.query("SELECT id, username FROM users WHERE id = ? AND role = 'caller' AND is_active = 1", [Number(callerId) || 0]);
    if (!caller) { await conn.rollback(); return { status: 400, message: "Please select an active Caller." }; }
    const [[row]] = await conn.query(`SELECT u.id, u.assigned_to_user_id, u.completed_at, (${NOT_IN_CONTACTS("u")}) AS not_contact FROM unfiltered_contacts u WHERE u.id = ? FOR UPDATE`, [Number(id) || 0]);
    if (!row) { await conn.rollback(); return { status: 404, message: "Unfiltered contact not found." }; }
    const cur = row.assigned_to_user_id == null ? 0 : Number(row.assigned_to_user_id);
    if (expectedCallerId !== undefined && Number(expectedCallerId) !== cur) {
      await conn.rollback();
      return { status: 409, message: "This contact's assignment has changed. Please refresh and try again." };
    }
    if (cur === Number(caller.id)) { await conn.rollback(); return { status: 200, message: `Already assigned to ${caller.username}.`, no_change: true, caller_id: caller.id, previous_caller_id: cur || null }; }
    if (row.completed_at) { await conn.rollback(); return { status: 409, message: "This call is already completed and cannot be reassigned." }; }
    if (!Number(row.not_contact)) { await conn.rollback(); return { status: 409, message: "This number is already a regular Contact and is no longer callable here." }; }
    await conn.query("UPDATE unfiltered_contacts SET assigned_to_user_id = ?, assigned_at = NOW(), assigned_by = ? WHERE id = ?", [caller.id, byUserId || null, row.id]);
    await conn.commit();
    return { status: 200, message: cur ? `Reassigned to ${caller.username}.` : `Assigned to ${caller.username}.`, caller_id: caller.id, caller_name: caller.username, previous_caller_id: cur || null };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// Bulk "Remove Assignment": clears ONLY the caller mapping (assigned_to_user_id / assigned_at / assigned_by)
// of the selected Unfiltered Contacts, in one transaction with the rows locked. Nothing is deleted:
// the contacts, their details, linked Contacts, completion state and call history stay as they are.
// `ids` = the chosen records; or `allMatching` (+ optional search `q`) = every ASSIGNED record the list
// shows for that search, across all pages. Returns { removed, skipped (already unassigned / unknown) }.
const BULK_MAX = 20000;
export async function bulkRemoveUnfilteredAssignments({ ids = [], allMatching = false, q = "" }) {
  await ensureUnfilteredCallLogSchema();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    let target;
    if (allMatching) {
      const where = ["assigned_to_user_id IS NOT NULL"], params = [];
      const term = String(q || "").trim();
      if (term) {
        const digits = term.replace(/\D/g, "");
        where.push(digits.length >= 3 ? "(person_name LIKE ? OR phone_key LIKE ?)" : "person_name LIKE ?");
        params.push(`%${term}%`);
        if (digits.length >= 3) params.push(`%${digits.slice(-10)}%`);
      }
      const [rows] = await conn.query(`SELECT id FROM unfiltered_contacts WHERE ${where.join(" AND ")} ORDER BY id LIMIT ${BULK_MAX} FOR UPDATE`, params);
      target = rows.map((r) => r.id);
    } else {
      const want = [...new Set((Array.isArray(ids) ? ids : []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))].slice(0, BULK_MAX);
      if (!want.length) { await conn.rollback(); return { status: 400, message: "Select at least one assigned call." }; }
      const [rows] = await conn.query(`SELECT id FROM unfiltered_contacts WHERE id IN (${want.map(() => "?").join(",")}) AND assigned_to_user_id IS NOT NULL ORDER BY id FOR UPDATE`, want);
      target = rows.map((r) => r.id);
      var requested = want.length;
    }
    let removed = 0;
    for (let i = 0; i < target.length; i += 500) {
      const chunk = target.slice(i, i + 500);
      // eslint-disable-next-line no-await-in-loop
      const [res] = await conn.query(`UPDATE unfiltered_contacts SET assigned_to_user_id = NULL, assigned_at = NULL, assigned_by = NULL WHERE id IN (${chunk.map(() => "?").join(",")}) AND assigned_to_user_id IS NOT NULL`, chunk);
      removed += res.affectedRows || 0;
    }
    await conn.commit();
    return { status: 200, removed, skipped: allMatching ? 0 : Math.max(0, (requested || 0) - removed), message: removed ? `Removed ${removed} assignment${removed === 1 ? "" : "s"}.` : "No assigned calls to remove." };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// DELETE Unfiltered Contact (call) records - not the same as Remove Assignment (which only clears the
// caller mapping). Deleting removes the record itself together with its own call log rows; the
// Contact List record that a Positive / Supporter outcome created is NEVER deleted - it just loses its
// back-link to the removed record (contacts.source_unfiltered_contact_id -> NULL; its 'source' tag and
// all its data stay). Runs in ONE transaction with the rows locked, so it is all-or-nothing: any failure
// rolls back and nothing is deleted. `ids` = the chosen records, or `allMatching` (+ search `q`) = every
// record the list shows for that search. Returns the ACTUAL result: { deleted, deleted_ids?, not_found }.
export async function deleteUnfilteredContacts({ ids = [], allMatching = false, q = "" }) {
  await ensureUnfilteredCallLogSchema();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    let target, requested;
    if (allMatching) {
      const where = ["1=1"], params = [];
      const term = String(q || "").trim();
      if (term) {
        const digits = term.replace(/\D/g, "");
        where.push(digits.length >= 3 ? "(person_name LIKE ? OR phone_key LIKE ?)" : "person_name LIKE ?");
        params.push(`%${term}%`);
        if (digits.length >= 3) params.push(`%${digits.slice(-10)}%`);
      }
      const [rows] = await conn.query(`SELECT id FROM unfiltered_contacts WHERE ${where.join(" AND ")} ORDER BY id LIMIT ${BULK_MAX} FOR UPDATE`, params);
      target = rows.map((r) => r.id);
    } else {
      const want = [...new Set((Array.isArray(ids) ? ids : []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))].slice(0, BULK_MAX);
      if (!want.length) { await conn.rollback(); return { status: 400, message: "Select at least one call." }; }
      requested = want.length;
      const [rows] = await conn.query(`SELECT id FROM unfiltered_contacts WHERE id IN (${want.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, want);
      target = rows.map((r) => r.id);
    }
    let deleted = 0;
    for (let i = 0; i < target.length; i += 500) {
      const chunk = target.slice(i, i + 500);
      const ph = chunk.map(() => "?").join(",");
      // eslint-disable-next-line no-await-in-loop
      await conn.query(`DELETE FROM unfiltered_call_logs WHERE unfiltered_contact_id IN (${ph})`, chunk);
      // eslint-disable-next-line no-await-in-loop
      await conn.query(`UPDATE contacts SET source_unfiltered_contact_id = NULL WHERE source_unfiltered_contact_id IN (${ph})`, chunk);
      // eslint-disable-next-line no-await-in-loop
      const [res] = await conn.query(`DELETE FROM unfiltered_contacts WHERE id IN (${ph})`, chunk);
      deleted += res.affectedRows || 0;
    }
    await conn.commit();
    return {
      status: 200, deleted, not_found: allMatching ? 0 : Math.max(0, (requested || 0) - target.length),
      deleted_ids: allMatching ? undefined : target,
      message: deleted ? `Deleted ${deleted} call record${deleted === 1 ? "" : "s"}.` : "No matching call records were found.",
    };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// Release (no log) of one Unfiltered Call: validates that it is the caller's own, still-pending call. It changes
// nothing - like the Regular Calls release, no log row is written and the assignment is kept; the call stays
// in the caller's queue.
export async function releaseUnfilteredCall({ id, callerId }) {
  const [row] = await query("SELECT id, assigned_to_user_id, completed_at FROM unfiltered_contacts WHERE id = ?", [Number(id) || 0]);
  if (!row || Number(row.assigned_to_user_id) !== Number(callerId)) return { status: 404, message: "This call is not assigned to you." };
  if (row.completed_at) return { status: 409, message: "This call is already completed." };
  return { status: 200, message: "Released without logging." };
}
