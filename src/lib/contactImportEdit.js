import { query, getPool } from "@/lib/db";
import { normalizePhone, resolveLoc, DISTRICT_ALIASES, ASSEMBLY_ALIASES } from "@/lib/workerImport";
import { norm } from "@/lib/cgGeoAliases";

// "Import Edit" — update EXISTING contacts in bulk from a spreadsheet. It never
// inserts a contact. A row is matched to ONE existing contact by Contact ID (preferred)
// or, when the file has no Contact ID column, by mobile number (last 10 digits;
// a number shared by several contacts is ambiguous and is NOT applied).
//
// Blank cell  = leave that field exactly as it is.
// "[clear]"   = explicitly empty a clearable text field (address, pincode, village,
//               remarks). Name, phone and designation can never be cleared this way.
// Designation = one or more EXISTING designation names (comma / semicolon separated);
//               the contact's designation set becomes exactly that list.
//
// Parsing/validation is a pure read (used for the preview AND, again, by the commit),
// so what the user confirmed is what is validated at write time.

export const CLEAR_TOKEN = "[clear]";
export const MAX_ROWS = 5000;

// Header aliases (case/space/punctuation-insensitive).
const COLS = {
  id: ["contact id", "contactid", "contact_id", "id", "sr id"],
  phone: ["phone", "mobile", "phone number", "mobile number", "phone no", "mobile no", "contact number", "mobile no."],
  new_phone: ["new phone", "new mobile", "new phone number", "new mobile number", "updated phone", "updated mobile"],
  name: ["name", "person name", "contact name", "full name", "new name"],
  address: ["address", "new address"],
  pincode: ["pincode", "pin code", "pin"],
  village: ["village", "gram"],
  remarks: ["remarks", "remark", "notes"],
  designation: ["designation", "designations", "position", "role"],
  district: ["district", "jila", "zila"],
  assembly: ["assembly", "vidhansabha", "vidhan sabha", "assembly constituency"],
};
const CLEARABLE = new Set(["address", "pincode", "village", "remarks"]);
const LABEL = {
  person_name: "Name", phone_number: "Phone", address: "Address", pincode: "Pincode", village: "Village",
  remarks: "Remarks", designation: "Designation", district_id: "District", assembly_id: "Assembly",
};

function headerIndex(headerRow) {
  const idx = {};
  (headerRow || []).forEach((h, i) => {
    const key = String(h ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.:*]+$/, "");
    if (!key) return;
    for (const [field, names] of Object.entries(COLS)) if (idx[field] === undefined && names.includes(key)) idx[field] = i;
  });
  return idx;
}
const cellStr = (v) => (v === null || v === undefined ? "" : String(v).trim());
const isClear = (v) => cellStr(v).toLowerCase() === CLEAR_TOKEN;
const phoneStore = (v) => cellStr(v).replace(/[^\d+]/g, "");
const sameText = (a, b) => cellStr(a) === cellStr(b);

let _cols;
async function contactColumns() {
  if (!_cols) {
    _cols = query(`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'`)
      .then((r) => new Set(r.map((x) => x.name))).catch((e) => { _cols = undefined; throw e; });
  }
  return _cols;
}

// rows = XLSX sheet_to_json(header:1) array; scope = { where, params } over alias "c"
// (extra AND-clause restricting which contacts the importer may touch) or null.
export async function parseImportEdit(rows, scope = null) {
  if (!Array.isArray(rows) || rows.length < 2) return { error: "The sheet has no data rows." };
  if (rows.length - 1 > MAX_ROWS) return { error: `Too many rows (${rows.length - 1}). Import Edit accepts up to ${MAX_ROWS} rows at a time.` };
  const idx = headerIndex(rows[0]);
  const byId = idx.id !== undefined;
  if (!byId && idx.phone === undefined) {
    return { error: "Could not find an identifier column. Add a \"Contact ID\" column (preferred) or a \"Phone\" column." };
  }
  // With a Contact ID column the Phone column is the NEW phone value; without one it is
  // the identifier and an optional "New Phone" column carries a replacement number.
  const phoneCol = byId ? idx.phone : idx.new_phone;
  const editable = ["name", "address", "pincode", "village", "remarks", "designation", "district", "assembly"].filter((f) => idx[f] !== undefined);
  if (phoneCol !== undefined) editable.push("phone");
  if (!editable.length) return { error: "No columns to update were found. Add at least one of: Name, Phone, Address, Pincode, Village, Remarks, Designation, District, Assembly." };

  const have = await contactColumns();
  const unsupported = editable.filter((f) => ({ pincode: "pincode", village: "village", remarks: "remarks", address: "address" }[f]) && !have.has(f));
  if (unsupported.length) return { error: `This database has no column for: ${unsupported.join(", ")}.` };

  const [districtRows, assemblyRows, desigRows] = await Promise.all([
    query("SELECT id, name FROM locations WHERE type = 'district'"),
    query("SELECT id, name, parent_id FROM locations WHERE type = 'assembly'"),
    query("SELECT id, name FROM designations"),
  ]);
  const districtByName = new Map(districtRows.map((r) => [norm(r.name), r.id]));
  const assemblyByName = new Map(assemblyRows.map((r) => [norm(r.name), r.id]));
  const assemblyParent = new Map(assemblyRows.map((r) => [r.id, r.parent_id]));
  const districtName = new Map(districtRows.map((r) => [r.id, r.name]));
  const assemblyName = new Map(assemblyRows.map((r) => [r.id, r.name]));
  const desigByName = new Map(desigRows.map((r) => [String(r.name).trim().toLowerCase(), r]));

  // ---- 1. identify (before any lookups) -------------------------------------------
  const parsed = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c) => cellStr(c) === "")) continue; // fully blank line
    const rowNum = i + 1; // as shown in Excel (header = row 1)
    const rec = { row: rowNum, raw: row, errors: [], status: null, contact_id: null, name: "", changes: [] };
    if (byId) {
      const raw = cellStr(row[idx.id]);
      const n = Number(raw);
      if (!raw) rec.errors.push("Missing Contact ID");
      else if (!Number.isInteger(n) || n <= 0) rec.errors.push(`Invalid Contact ID "${raw}"`);
      else rec.ident = { kind: "id", value: n };
    } else {
      const raw = cellStr(row[idx.phone]);
      const key = normalizePhone(raw);
      if (!raw) rec.errors.push("Missing Phone (identifier)");
      else if (!key || key.length < 10) rec.errors.push(`Invalid phone number "${raw}"`);
      else rec.ident = { kind: "phone", value: key, raw };
    }
    parsed.push(rec);
  }
  // Duplicate identifiers inside the file are ambiguous: NONE of those rows is applied.
  const seen = new Map();
  for (const r of parsed) if (r.ident) { const k = `${r.ident.kind}:${r.ident.value}`; if (!seen.has(k)) seen.set(k, []); seen.get(k).push(r.row); }
  for (const r of parsed) {
    if (!r.ident) continue;
    const k = `${r.ident.kind}:${r.ident.value}`;
    if (seen.get(k).length > 1) { r.status = "duplicate_identifier"; r.errors.push(`${r.ident.kind === "id" ? "Contact ID" : "Phone"} ${r.ident.kind === "id" ? r.ident.value : r.ident.raw} appears on rows ${seen.get(k).join(", ")} — not applied`); }
  }

  // ---- 2. look up the existing contacts ---------------------------------------------
  const scopeSql = scope?.where ? ` ${scope.where.replace(/^\s*AND\s*/i, "AND ")}` : "";
  const scopeParams = scope?.params || [];
  const liveIds = new Map(); // id -> contact row (in scope)
  const anyIds = new Set();  // id exists at all (scope-independent) → tells "unmatched" from "out of scope"
  const byPhone = new Map(); // last10 -> [contact rows in scope]
  const cols = ["c.id", "c.person_name", "c.phone_number", ...["address", "pincode", "village", "remarks", "designation_id", "district_id", "assembly_id"].filter((f) => have.has(f)).map((f) => `c.${f}`)];
  const ids = [...new Set(parsed.filter((r) => r.ident?.kind === "id").map((r) => r.ident.value))];
  if (ids.length) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      // eslint-disable-next-line no-await-in-loop
      (await query(`SELECT id FROM contacts WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk)).forEach((r) => anyIds.add(r.id));
      // eslint-disable-next-line no-await-in-loop
      (await query(`SELECT ${cols.join(", ")} FROM contacts c WHERE c.id IN (${chunk.map(() => "?").join(",")})${scopeSql}`, [...chunk, ...scopeParams])).forEach((r) => liveIds.set(r.id, r));
    }
  }
  const phones = [...new Set(parsed.filter((r) => r.ident?.kind === "phone").map((r) => r.ident.value))];
  if (phones.length) {
    const L10 = "RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10)";
    for (let i = 0; i < phones.length; i += 500) {
      const chunk = phones.slice(i, i + 500);
      // eslint-disable-next-line no-await-in-loop
      const found = await query(`SELECT ${cols.join(", ")}, ${L10} AS k FROM contacts c WHERE ${L10} IN (${chunk.map(() => "?").join(",")})${scopeSql}`, [...chunk, ...scopeParams]);
      for (const r of found) { if (!byPhone.has(r.k)) byPhone.set(r.k, []); byPhone.get(r.k).push(r); }
      // eslint-disable-next-line no-await-in-loop
      const all = await query(`SELECT ${L10} AS k FROM contacts c WHERE ${L10} IN (${chunk.map(() => "?").join(",")})`, chunk);
      for (const r of all) anyIds.add(`p:${r.k}`);
    }
  }
  // Current designation names per matched contact (for from → to display + no-change test).
  const curDesig = new Map();
  const matchedIds = new Set([...liveIds.keys(), ...[...byPhone.values()].flat().map((r) => r.id)]);
  if (matchedIds.size && editable.includes("designation")) {
    const mids = [...matchedIds];
    for (let i = 0; i < mids.length; i += 500) {
      const chunk = mids.slice(i, i + 500);
      // eslint-disable-next-line no-await-in-loop
      const rs = await query(`SELECT cd.contact_id, d.id, d.name FROM contact_designations cd JOIN designations d ON d.id = cd.designation_id WHERE cd.contact_id IN (${chunk.map(() => "?").join(",")}) ORDER BY cd.id`, chunk).catch(() => []);
      for (const r of rs) { if (!curDesig.has(r.contact_id)) curDesig.set(r.contact_id, []); curDesig.get(r.contact_id).push({ id: r.id, name: r.name }); }
    }
  }

  // New phone numbers must not collide with a DIFFERENT contact (or each other).
  const newPhoneRows = new Map(); // last10 -> [row numbers] (within file)
  if (editable.includes("phone")) {
    for (const r of parsed) {
      const v = cellStr(r.raw[phoneCol]);
      if (!v) continue;
      const k = normalizePhone(v);
      if (k && k.length >= 10) { if (!newPhoneRows.has(k)) newPhoneRows.set(k, []); newPhoneRows.get(k).push(r.row); }
    }
  }
  const takenBy = new Map(); // last10 -> contact ids that already hold it
  if (newPhoneRows.size) {
    const L10 = "RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone_number, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10)";
    const ks = [...newPhoneRows.keys()];
    for (let i = 0; i < ks.length; i += 500) {
      const chunk = ks.slice(i, i + 500);
      // eslint-disable-next-line no-await-in-loop
      for (const r of await query(`SELECT id, ${L10} AS k FROM contacts WHERE ${L10} IN (${chunk.map(() => "?").join(",")})`, chunk)) {
        if (!takenBy.has(r.k)) takenBy.set(r.k, []);
        takenBy.get(r.k).push(r.id);
      }
    }
  }

  // ---- 3. per-row: match + validate + diff ------------------------------------------
  for (const rec of parsed) {
    if (rec.status === "duplicate_identifier") continue;
    if (rec.errors.length) { rec.status = "error"; continue; }
    let cur = null;
    if (rec.ident.kind === "id") {
      cur = liveIds.get(rec.ident.value) || null;
      if (!cur) { rec.status = anyIds.has(rec.ident.value) ? "out_of_scope" : "unmatched"; rec.errors.push(anyIds.has(rec.ident.value) ? `Contact ${rec.ident.value} is outside your area` : `No contact with ID ${rec.ident.value}`); continue; }
    } else {
      const hits = byPhone.get(rec.ident.value) || [];
      if (hits.length === 0) { rec.status = anyIds.has(`p:${rec.ident.value}`) ? "out_of_scope" : "unmatched"; rec.errors.push(anyIds.has(`p:${rec.ident.value}`) ? `Phone ${rec.ident.raw} belongs to a contact outside your area` : `No contact with phone ${rec.ident.raw}`); continue; }
      if (hits.length > 1) { rec.status = "error"; rec.errors.push(`Phone ${rec.ident.raw} matches ${hits.length} contacts (IDs ${hits.map((h) => h.id).join(", ")}) — use Contact ID`); continue; }
      cur = hits[0];
    }
    rec.contact_id = cur.id;
    rec.name = cur.person_name || "";
    rec.update = {};     // column -> new value
    let newDesigIds = null;

    const get = (f) => rows[rec.row - 1][idx[f]];
    for (const f of editable) {
      if (f === "phone") {
        const v = cellStr(rec.raw[phoneCol]);
        if (!v) continue;
        if (isClear(v)) { rec.errors.push("Phone cannot be cleared"); continue; }
        const key = normalizePhone(v);
        if (!key || key.length < 10) { rec.errors.push(`Invalid phone number "${v}"`); continue; }
        if (key === normalizePhone(cur.phone_number)) continue; // unchanged
        if ((newPhoneRows.get(key) || []).length > 1) { rec.errors.push(`New phone ${v} is used on more than one row (${newPhoneRows.get(key).join(", ")})`); continue; }
        const holders = (takenBy.get(key) || []).filter((id) => id !== cur.id);
        if (holders.length) { rec.errors.push(`Phone ${v} already belongs to contact #${holders[0]}`); continue; }
        rec.update.phone_number = phoneStore(v);
        rec.changes.push({ field: "phone_number", label: LABEL.phone_number, from: cur.phone_number || "", to: rec.update.phone_number });
      } else if (f === "name") {
        const v = cellStr(get(f));
        if (!v) continue;
        if (isClear(v)) { rec.errors.push("Name cannot be cleared"); continue; }
        if (v.length > 200) { rec.errors.push("Name is too long (max 200 characters)"); continue; }
        if (!sameText(v, cur.person_name)) { rec.update.person_name = v; rec.changes.push({ field: "person_name", label: LABEL.person_name, from: cur.person_name || "", to: v }); }
      } else if (CLEARABLE.has(f)) {
        const v = cellStr(get(f));
        if (!v) continue; // blank → unchanged
        let to = v;
        if (isClear(v)) to = null;
        else if (f === "pincode" && !/^\d{6}$/.test(v)) { rec.errors.push(`Invalid pincode "${v}" (6 digits)`); continue; }
        else if (v.length > 2000) { rec.errors.push(`${LABEL[f]} is too long`); continue; }
        const before = cur[f] ?? null;
        if (to === null ? before !== null && cellStr(before) !== "" : !sameText(to, before)) {
          rec.update[f] = to;
          rec.changes.push({ field: f, label: LABEL[f], from: before ?? "", to: to === null ? "(cleared)" : to });
        }
      } else if (f === "designation") {
        const v = cellStr(get(f));
        if (!v) continue;
        if (isClear(v)) { rec.errors.push("Designation cannot be cleared"); continue; }
        const names = [...new Set(v.split(/[;,|]/).map((s) => s.trim()).filter(Boolean))];
        const found = names.map((n) => desigByName.get(n.toLowerCase()));
        const missing = names.filter((_, i) => !found[i]);
        if (missing.length) { rec.errors.push(`Unknown designation: ${missing.join(", ")}`); continue; }
        const idsNew = found.map((d) => d.id);
        const before = (curDesig.get(cur.id) || []).map((d) => d.id);
        if (before.length === idsNew.length && before.every((x) => idsNew.includes(x))) continue; // same set
        newDesigIds = idsNew;
        rec.changes.push({ field: "designation", label: LABEL.designation, from: (curDesig.get(cur.id) || []).map((d) => d.name).join(", "), to: found.map((d) => d.name).join(", ") });
      } else if (f === "district" || f === "assembly") {
        const v = cellStr(get(f));
        if (!v) continue;
        if (isClear(v)) { rec.errors.push(`${LABEL[f + "_id"]} cannot be cleared`); continue; }
        rec[`_${f}`] = v;
      }
    }
    // Geography: resolve district / assembly together so they stay consistent.
    if (rec._district || rec._assembly) {
      const did = rec._district ? resolveLoc(norm(rec._district), districtByName, DISTRICT_ALIASES) : null;
      const aid = rec._assembly ? resolveLoc(norm(rec._assembly), assemblyByName, ASSEMBLY_ALIASES) : null;
      if (rec._district && !did) rec.errors.push(`Unknown district "${rec._district}"`);
      if (rec._assembly && !aid) rec.errors.push(`Unknown assembly "${rec._assembly}"`);
      if (!rec.errors.length) {
        const parentOfA = aid ? assemblyParent.get(aid) : null;
        if (did && aid && parentOfA && parentOfA !== did) rec.errors.push(`Assembly "${rec._assembly}" is not in district "${rec._district}"`);
        else {
          const newDistrict = did || (aid ? parentOfA : null);
          if (aid && have.has("assembly_id") && String(cur.assembly_id ?? "") !== String(aid)) {
            rec.update.assembly_id = aid;
            rec.changes.push({ field: "assembly_id", label: LABEL.assembly_id, from: assemblyName.get(cur.assembly_id) || "", to: assemblyName.get(aid) });
          }
          if (newDistrict && have.has("district_id") && String(cur.district_id ?? "") !== String(newDistrict)) {
            rec.update.district_id = newDistrict;
            rec.changes.push({ field: "district_id", label: LABEL.district_id, from: districtName.get(cur.district_id) || "", to: districtName.get(newDistrict) });
          }
        }
      }
    }
    delete rec._district; delete rec._assembly;
    if (newDesigIds) rec.designation_ids = newDesigIds;

    if (rec.errors.length) { rec.status = "error"; rec.changes = []; rec.update = {}; delete rec.designation_ids; continue; }
    rec.status = rec.changes.length ? "update" : "no_change";
  }

  const count = (s) => parsed.filter((r) => r.status === s).length;
  const summary = {
    total_rows: parsed.length,
    matched: parsed.filter((r) => r.contact_id).length,
    to_update: count("update"),
    no_change: count("no_change"),
    unmatched: count("unmatched"),
    out_of_scope: count("out_of_scope"),
    duplicate_identifiers: count("duplicate_identifier"),
    errors: count("error"),
  };
  return { rows: parsed, summary, columns: editable, identifier: byId ? "Contact ID" : "Phone" };
}

// Apply the validated "update" rows. Each row is its own small transaction, so one
// failing row (e.g. a phone taken by a concurrent edit) never blocks or rolls back the
// others — it is reported as failed. Only existing rows are UPDATEd; nothing is inserted.
export async function applyImportEdit(parsed) {
  const have = await contactColumns();
  const pool = getPool();
  let updated = 0;
  for (const r of parsed.rows.filter((x) => x.status === "update")) {
    const sets = [], vals = [];
    for (const [col, v] of Object.entries(r.update || {})) { sets.push(`${col} = ?`); vals.push(v); }
    if (r.designation_ids) { sets.push("designation_id = ?"); vals.push(r.designation_ids[0] ?? null); } // legacy primary mirrors the first
    if (have.has("updated_at")) sets.push("updated_at = NOW()");
    if (!sets.length) continue;
    // eslint-disable-next-line no-await-in-loop
    const conn = await pool.getConnection();
    try {
      // eslint-disable-next-line no-await-in-loop
      await conn.beginTransaction();
      // eslint-disable-next-line no-await-in-loop
      const [res] = await conn.query(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, [...vals, r.contact_id]);
      if (!res.affectedRows) throw new Error("Contact no longer exists");
      if (r.designation_ids) {
        // eslint-disable-next-line no-await-in-loop
        await conn.query("DELETE FROM contact_designations WHERE contact_id = ?", [r.contact_id]);
        for (const d of r.designation_ids) {
          // eslint-disable-next-line no-await-in-loop
          await conn.query("INSERT IGNORE INTO contact_designations (contact_id, designation_id) VALUES (?, ?)", [r.contact_id, d]);
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await conn.commit();
      r.status = "updated";
      updated++;
    } catch (e) {
      // eslint-disable-next-line no-await-in-loop
      try { await conn.rollback(); } catch { /* ignore */ }
      r.status = "failed";
      r.errors.push(e?.code === "ER_DUP_ENTRY" ? "That phone number is already used by another contact" : (e?.sqlMessage || e?.message || "Update failed"));
    } finally {
      conn.release();
    }
  }
  parsed.summary.updated = updated;
  parsed.summary.failed = parsed.rows.filter((x) => x.status === "failed").length;
  return parsed;
}

