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
