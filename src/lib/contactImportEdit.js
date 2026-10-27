import { query, getPool } from "@/lib/db";
import { normalizePhone, resolveLoc, DISTRICT_ALIASES, ASSEMBLY_ALIASES } from "@/lib/workerImport";
import { norm } from "@/lib/cgGeoAliases";
import { contactEffectiveZoneId, releaseOutOfZoneAssignment } from "@/lib/contactZone";

// "Import Edit" — update EXISTING contacts in bulk from a spreadsheet. It never
// inserts a contact. A row is matched to ONE existing contact by Contact ID (preferred)
// or, when the file has no Contact ID column, by mobile number (last 10 digits;
// a number shared by several contacts is ambiguous and is NOT applied).
//
// Column absent  = that field is not part of the import at all (never read, never written).
// Blank cell     = leave that field exactly as it is.
// Same value     = "no change" (nothing is written for it).
// Different value= updated, and ONLY that column is written (every other column of the
//                  contact — photo, address, zone, block, ... — is left untouched).
// Safe writes    : each changed column is guarded by compare-and-set against the value that
//                  was validated, so a contact edited by someone else after the preview is
//                  reported as failed instead of being overwritten.
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
  // "Village/City" and "Remarks/Notes" are the Contact export's own headings, so an exported
  // sheet can be edited and imported back as is.
  village: ["village", "gram", "village/city", "village / city", "village city", "city"],
  remarks: ["remarks", "remark", "notes", "remarks/notes", "remarks / notes", "remarks notes"],
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
// The heading as shown (for the "ignored columns" notice).
const headerKey = (h) => String(h ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.:*]+$/, "");
const cellStr = (v) => (v === null || v === undefined ? "" : String(v).trim());
const isClear = (v) => cellStr(v).toLowerCase() === CLEAR_TOKEN;
const phoneStore = (v) => cellStr(v).replace(/[^\d+]/g, "");
const sameText = (a, b) => cellStr(a) === cellStr(b);

// Max lengths of the text columns, so an over-long value is REJECTED rather than silently
// truncated by a non-strict database.
let _lens;
async function columnLengths() {
  if (!_lens) {
    _lens = query(`SELECT COLUMN_NAME AS name, CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND CHARACTER_MAXIMUM_LENGTH IS NOT NULL`)
      .then((r) => new Map(r.map((x) => [x.name, Number(x.len)]))).catch((e) => { _lens = undefined; throw e; });
  }
  return _lens;
}

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
  const used = new Set(Object.values(idx));
  // Columns in the file that Import Edit does not read — reported so a value in one of them
  // (e.g. Zone, Qualification) is never silently dropped without the user knowing.
  const ignoredColumns = (rows[0] || []).map((h, i) => ({ h: String(h ?? "").trim(), i })).filter((x) => x.h && !used.has(x.i)).map((x) => x.h);
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
  const maxLen = await columnLengths();
  const tooLong = (col, v) => maxLen.has(col) && String(v).length > maxLen.get(col);
  const unsupported = editable.filter((f) => ({ pincode: "pincode", village: "village", remarks: "remarks", address: "address" }[f]) && !have.has(f));
  if (unsupported.length) return { error: `This database has no column for: ${unsupported.join(", ")}.` };

  const [districtRows, assemblyRows, desigRows] = await Promise.all([
    query("SELECT id, name, parent_id FROM locations WHERE type = 'district'"),
    query("SELECT id, name, parent_id FROM locations WHERE type = 'assembly'"),
    query("SELECT id, name FROM designations"),
  ]);
  const districtByName = new Map(districtRows.map((r) => [norm(r.name), r.id]));
  const assemblyByName = new Map(assemblyRows.map((r) => [norm(r.name), r.id]));
  const assemblyParent = new Map(assemblyRows.map((r) => [r.id, r.parent_id]));
  const districtName = new Map(districtRows.map((r) => [r.id, r.name]));
  // district -> its Lok Sabha and that Lok Sabha's Zone (to keep a contact's own Lok Sabha / Zone
  // in step when its district is changed — see the geography block below).
  const lsRows = await query("SELECT id, parent_id FROM locations WHERE type = 'lok_sabha'");
  const lsZone = new Map(lsRows.map((r) => [r.id, r.parent_id]));
  const districtLs = new Map(districtRows.map((r) => [r.id, lsZone.has(r.parent_id) ? r.parent_id : null]));
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
  const cols = ["c.id", "c.person_name", "c.phone_number", ...["address", "pincode", "village", "remarks", "designation_id", "district_id", "assembly_id", "zone_id", "lok_sabha_id", "ward_id"].filter((f) => have.has(f)).map((f) => `c.${f}`)];
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
    // A contact with no designation-set rows but a legacy primary designation_id IS holding
    // that designation (the Contact List / export show it) — treat it as the current value so
    // an unchanged cell is "no change", not a phantom update.
    const desigById = new Map(desigRows.map((d) => [d.id, d]));
    for (const c of [...liveIds.values(), ...[...byPhone.values()].flat()]) {
      if (!curDesig.has(c.id) && c.designation_id && desigById.has(c.designation_id)) curDesig.set(c.id, [{ id: c.designation_id, name: desigById.get(c.designation_id).name }]);
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
        if (tooLong("phone_number", phoneStore(v))) { rec.errors.push(`Phone ${v} is too long (max ${maxLen.get("phone_number")} characters)`); continue; }
        rec.update.phone_number = phoneStore(v);
        rec.changes.push({ field: "phone_number", label: LABEL.phone_number, from: cur.phone_number || "", to: rec.update.phone_number });
      } else if (f === "name") {
        const v = cellStr(get(f));
        if (!v) continue;
        if (isClear(v)) { rec.errors.push("Name cannot be cleared"); continue; }
        if (v.length > 200 || tooLong("person_name", v)) { rec.errors.push(`Name is too long (max ${Math.min(200, maxLen.get("person_name") || 200)} characters)`); continue; }
        if (!sameText(v, cur.person_name)) { rec.update.person_name = v; rec.changes.push({ field: "person_name", label: LABEL.person_name, from: cur.person_name || "", to: v }); }
      } else if (CLEARABLE.has(f)) {
        const v = cellStr(get(f));
        if (!v) continue; // blank → unchanged
        let to = v;
        if (isClear(v)) to = null;
        else if (f === "pincode" && !/^\d{6}$/.test(v)) { rec.errors.push(`Invalid pincode "${v}" (6 digits)`); continue; }
        else if (v.length > 2000 || tooLong(f, v)) { rec.errors.push(`${LABEL[f]} is too long (max ${Math.min(2000, maxLen.get(f) || 2000)} characters)`); continue; }
        const before = cur[f] ?? null;
        if (to === null ? before !== null && cellStr(before) !== "" : !sameText(to, before)) {
          rec.update[f] = to;
          rec.changes.push({ field: f, label: LABEL[f], from: before ?? "", to: to === null ? "(cleared)" : to, cleared: to === null });
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
          // Never leave a contact half-moved or silently drop its lower levels: if the district
          // changes and the contact's CURRENT assembly is in a different district, or the
          // assembly changes while the contact has a Block, the row is rejected (nothing is
          // written) with the reason — fix that contact on the Contact Page, or include a
          // matching Assembly column.
          const districtChanges = newDistrict && String(cur.district_id ?? "") !== String(newDistrict);
          const assemblyChanges = aid && String(cur.assembly_id ?? "") !== String(aid);
          if (districtChanges && !aid && cur.assembly_id && assemblyParent.get(cur.assembly_id) !== newDistrict) {
            rec.errors.push(`This contact's Assembly (${assemblyName.get(cur.assembly_id) || cur.assembly_id}) is not in district "${districtName.get(newDistrict)}". Add an Assembly column for it, or change it on the Contact Page — nothing was changed.`);
          } else if (assemblyChanges && cur.ward_id) {
            rec.errors.push("This contact has a Block under its current Assembly, which would no longer match. Change the Assembly on the Contact Page so the Block can be re-selected — nothing was changed.");
          }
          if (aid && have.has("assembly_id") && String(cur.assembly_id ?? "") !== String(aid)) {
            rec.update.assembly_id = aid;
            rec.changes.push({ field: "assembly_id", label: LABEL.assembly_id, from: assemblyName.get(cur.assembly_id) || "", to: assemblyName.get(aid) });
          }
          if (newDistrict && have.has("district_id") && String(cur.district_id ?? "") !== String(newDistrict)) {
            rec.update.district_id = newDistrict;
            rec.changes.push({ field: "district_id", label: LABEL.district_id, from: districtName.get(cur.district_id) || "", to: districtName.get(newDistrict) });
            // A contact that carries its OWN Lok Sabha / Zone would otherwise keep the old ones and
            // the Contact Page (own value first) would not show the move. Move them with the district.
            const newLs = districtLs.get(newDistrict) || null;
            const newZone = newLs ? lsZone.get(newLs) || null : null;
            if (newLs && cur.lok_sabha_id && String(cur.lok_sabha_id) !== String(newLs)) {
              rec.update.lok_sabha_id = newLs;
              rec.changes.push({ field: "lok_sabha_id", label: "Lok Sabha", from: "", to: "follows the new district" });
            }
            if (newZone && cur.zone_id && String(cur.zone_id) !== String(newZone)) {
              rec.update.zone_id = newZone;
              rec.changes.push({ field: "zone_id", label: "Zone", from: "", to: "follows the new district" });
            }
          }
        }
      }
    }
    delete rec._district; delete rec._assembly;
    if (newDesigIds) rec.designation_ids = newDesigIds;

    if (rec.errors.length) { rec.status = "error"; rec.changes = []; rec.update = {}; delete rec.designation_ids; continue; }
    // Values the validation saw, for the compare-and-set in applyImportEdit.
    rec.before = {};
    for (const col of Object.keys(rec.update)) rec.before[col] = cur[col] ?? null;
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
    // Fields the file would deliberately EMPTY with "[clear]" — the commit refuses to run
    // until the user has confirmed these.
    fields_cleared: parsed.filter((r) => r.status === "update").reduce((n, r) => n + r.changes.filter((c) => c.cleared).length, 0),
  };
  return { rows: parsed, summary, columns: editable, ignoredColumns, identifier: byId ? "Contact ID" : "Phone" };
}

// Apply the validated "update" rows. Each row is its own small transaction, so one
// failing row (e.g. a phone taken by a concurrent edit) never blocks or rolls back the
// others — it is reported as failed. Only existing rows are UPDATEd; nothing is inserted.
export async function applyImportEdit(parsed, session = null) {
  const have = await contactColumns();
  const pool = getPool();
  let updated = 0;
  for (const r of parsed.rows.filter((x) => x.status === "update")) {
    const sets = [], vals = [];
    const guards = [], gvals = [];
    for (const [col, v] of Object.entries(r.update || {})) {
      sets.push(`${col} = ?`); vals.push(v);
      // compare-and-set: only overwrite the value that was validated (NULL-safe).
      guards.push(`${col} <=> ?`); gvals.push(r.before ? r.before[col] ?? null : null);
    }
    if (r.designation_ids) { sets.push("designation_id = ?"); vals.push(r.designation_ids[0] ?? null); } // legacy primary mirrors the first
    if (have.has("updated_at")) sets.push("updated_at = NOW()");
    if (!sets.length) continue;
    // The contact's Zone as the Contact Page shows it, before this edit.
    // eslint-disable-next-line no-await-in-loop
    const zoneBefore = await contactEffectiveZoneId(r.contact_id);
    // eslint-disable-next-line no-await-in-loop
    const conn = await pool.getConnection();
    try {
      // eslint-disable-next-line no-await-in-loop
      await conn.beginTransaction();
      // eslint-disable-next-line no-await-in-loop
      const [res] = await conn.query(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?${guards.length ? ` AND ${guards.join(" AND ")}` : ""}`, [...vals, r.contact_id, ...gvals]);
      if (!res.affectedRows) {
        const [[still]] = await conn.query("SELECT id FROM contacts WHERE id = ?", [r.contact_id]);
        throw new Error(still ? "This contact was changed by someone else after the preview — nothing was saved for it. Re-run the preview." : "Contact no longer exists");
      }
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
      // Zone moved → release an assignment held by a caller of the OLD Zone (same rule as a
      // Contact Page edit), so the contact leaves that caller's queue too.
      // eslint-disable-next-line no-await-in-loop
      const zoneAfter = await contactEffectiveZoneId(r.contact_id).catch(() => zoneBefore);
      if (String(zoneBefore ?? "") !== String(zoneAfter ?? "")) await releaseOutOfZoneAssignment(session, r.contact_id, zoneAfter).catch(() => {});
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

