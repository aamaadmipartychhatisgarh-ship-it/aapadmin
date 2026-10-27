import { query, getPool } from "@/lib/db";
import { normalizePhone, resolveLoc, DISTRICT_ALIASES, ASSEMBLY_ALIASES } from "@/lib/workerImport";
import { norm } from "@/lib/cgGeoAliases";
import { contactEffectiveZoneId, releaseOutOfZoneAssignment } from "@/lib/contactZone";
import { CONTACT_FIELDS, normHeader, splitNameList } from "@/lib/contactFieldConfig";
import { validateContactPhotoUrl } from "@/lib/contactPhotoUrl";
import { parseQualificationCells, parseVehicleCell, parseStatusCell } from "@/lib/contactFieldParse";
import { EDUCATION_LEVELS } from "@/lib/qualificationOptions";
import { currentRowsFor, validateRows } from "@/lib/contactDesignationRows";
import { sameRows } from "@/lib/designationRows";
import { assignSingleContact } from "@/lib/contactAssign";

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

// Header aliases (case/space/punctuation-insensitive) - generated from the ONE field registry
// (lib/contactFieldConfig) that the Export headings and the Import template also use. "New Phone" is the only
// extra: with a Contact ID column the Phone column is the new value; without one it identifies the contact.
const COLS = {
  ...Object.fromEntries(CONTACT_FIELDS.map((f) => [f.key, [normHeader(f.label), ...f.aliases]])),
  new_phone: ["new phone", "new mobile", "new phone number", "new mobile number", "updated phone", "updated mobile"],
};
const CLEARABLE = new Set(["address", "pincode", "village", "remarks"]);
const LABEL = {
  person_name: "Name", phone_number: "Phone", address: "Address", pincode: "Pincode", village: "Village",
  remarks: "Remarks", designation: "Designation", district_id: "District", assembly_id: "Assembly",
  zone_id: "Zone", lok_sabha_id: "Lok Sabha", ward_id: "Block", qualification: "Qualification",
  education_level: "Education Level", vehicle: "Vehicle", photo_url: "Photo", assigned_to_user_id: "Assigned Caller", is_completed: "Status",
};
const E_SHOW = Object.fromEntries(EDUCATION_LEVELS.map((e) => [e.value, e.label]));

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
// opts.canAssign  - may this user (re)assign a contact to a Caller (admin or Contacts grant) - "Assigned Caller" column
// opts.canSetStatus - may this user set Pending / Done (admin) - "Status" column
export async function parseImportEdit(rows, scope = null, opts = {}) {
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
  const EDITABLE = ["name", "address", "pincode", "village", "remarks", "designation", "wing", "district", "assembly", "zone", "lok_sabha", "block", "qualification", "education_level", "vehicle", "photo_url", "assigned_caller", "status"];
  if (idx.wing !== undefined && idx.designation === undefined) return { error: "The Wing column needs the Designation column next to it (each Wing belongs to the designation in the same position)." };
  const editable = EDITABLE.filter((f) => idx[f] !== undefined);
  if (phoneCol !== undefined) editable.push("phone");
  if (!editable.length) return { error: "No columns to update were found. Add at least one of: " + CONTACT_FIELDS.filter((f) => f.key !== "id").map((f) => f.label).join(", ") + "." };

  const have = await contactColumns();
  const maxLen = await columnLengths();
  const tooLong = (col, v) => maxLen.has(col) && String(v).length > maxLen.get(col);
  const needCol = { pincode: "pincode", village: "village", remarks: "remarks", address: "address", qualification: "qualification", education_level: "education_level", vehicle: "vehicle", photo_url: "photo_url", zone: "zone_id", lok_sabha: "lok_sabha_id", block: "ward_id", status: "is_completed", assigned_caller: "assigned_to_user_id" };
  const unsupported = editable.filter((f) => needCol[f] && !have.has(needCol[f]));
  if (unsupported.length) return { error: `This database has no column for: ${unsupported.join(", ")}.` };

  const [districtRows, assemblyRows, desigRows, zoneRows, wardRows, callerRows] = await Promise.all([
    query("SELECT id, name, parent_id FROM locations WHERE type = 'district'"),
    query("SELECT id, name, parent_id FROM locations WHERE type = 'assembly'"),
    query("SELECT id, name FROM designations"),
    query("SELECT id, name FROM locations WHERE type = 'zone'"),
    query("SELECT id, name, parent_id FROM locations WHERE type = 'ward'"),
    editable.includes("assigned_caller") ? query("SELECT id, username FROM users WHERE role = 'caller' AND (is_active IS NULL OR is_active = 1)") : Promise.resolve([]),
  ]);
  const zoneByName = new Map(zoneRows.map((r) => [norm(r.name), r.id]));
  const lsByName = new Map();
  const wardByKey = new Map(wardRows.map((r) => [`${r.parent_id}|${norm(r.name)}`, r.id]));
  const wardName = new Map(wardRows.map((r) => [r.id, r.name]));
  const callerByName = new Map(callerRows.map((r) => [String(r.username).trim().toLowerCase(), r]));
  const callerNameById = new Map();
  const districtByName = new Map(districtRows.map((r) => [norm(r.name), r.id]));
  const assemblyByName = new Map(assemblyRows.map((r) => [norm(r.name), r.id]));
  const assemblyParent = new Map(assemblyRows.map((r) => [r.id, r.parent_id]));
  const districtName = new Map(districtRows.map((r) => [r.id, r.name]));
  // district -> its Lok Sabha and that Lok Sabha's Zone (to keep a contact's own Lok Sabha / Zone
  // in step when its district is changed — see the geography block below).
  const lsRows = await query("SELECT id, parent_id FROM locations WHERE type = 'lok_sabha'");
  const lsZone = new Map(lsRows.map((r) => [r.id, r.parent_id]));
  const lsNameRows = await query("SELECT id, name FROM locations WHERE type = 'lok_sabha'");
  for (const r of lsNameRows) lsByName.set(norm(r.name), r.id);
  const lsName = new Map(lsNameRows.map((r) => [r.id, r.name]));
  const zoneName = new Map(zoneRows.map((r) => [r.id, r.name]));
  const districtLs = new Map(districtRows.map((r) => [r.id, lsZone.has(r.parent_id) ? r.parent_id : null]));
  const assemblyName = new Map(assemblyRows.map((r) => [r.id, r.name]));
  const desigByName = new Map(desigRows.map((r) => [String(r.name).trim().toLowerCase(), r]));
  const desigKnown = new Set(desigByName.keys());
  const desigNameById = new Map(desigRows.map((r) => [r.id, r.name]));

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
  const cols = ["c.id", "c.person_name", "c.phone_number", ...["address", "pincode", "village", "remarks", "designation_id", "district_id", "assembly_id", "zone_id", "lok_sabha_id", "ward_id", "qualification", "education_level", "vehicle", "photo_url", "assigned_to_user_id", "is_completed"].filter((f) => have.has(f)).map((f) => `c.${f}`)];
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
        // Designation (+ the Wing of each, aligned by position). The contact's designation set becomes exactly the
        // listed names; a Wing cell pairs each designation with its Wing (extra Wings beyond the designations are
        // standalone Wing tags). Blank cells leave everything as it is; a retained designation keeps its Wing when
        // the Wing cell is blank.
        const v = cellStr(get(f));
        if (!v) continue;
        if (isClear(v)) { rec.errors.push("Designation cannot be cleared"); continue; }
        const names = [...new Set(splitNameList(v, desigKnown))];
        const found = names.map((n) => desigByName.get(n.toLowerCase()));
        const missing = names.filter((_, i) => !found[i]);
        if (missing.length) { rec.errors.push(`Unknown designation: ${missing.join(", ")}`); continue; }
        const idsNew = found.map((d) => d.id);
        const wcell = idx.wing !== undefined ? cellStr(rec.raw[idx.wing]) : "";
        let curRows = (await currentRowsFor(cur.id)).rows;
        // A contact holding only the legacy primary designation_id IS holding that designation (as the list / export show).
        if (!curRows.some((r) => r.designation_id) && cur.designation_id) curRows = [{ designation_id: cur.designation_id, wing: "" }, ...curRows];
        let target;
        if (wcell) {
          if (isClear(wcell)) { rec.errors.push("Wing cannot be cleared here — set it to Main Organisation instead"); continue; }
          const wl = wcell.split(/[;,|]/).map((x) => x.trim()).filter((x, i, arr) => x !== "" || i < names.length);
          if (wl.length < names.length) { rec.errors.push(`Wing list has ${wl.length} entr${wl.length === 1 ? "y" : "ies"} but there ${names.length === 1 ? "is 1 designation" : `are ${names.length} designations`} — give one Wing per designation (Main Organisation for none)`); continue; }
          const mainLc = "main organisation";
          const rowsT = idsNew.map((id, i) => ({ designation_id: id, wing: wl[i] && wl[i].toLowerCase() !== mainLc ? wl[i] : "" }));
          const extras = wl.slice(names.length).filter(Boolean).filter((w) => w.toLowerCase() !== mainLc).map((w) => ({ designation_id: null, wing: w }));
          target = [...rowsT, ...(extras.length ? extras : curRows.filter((r) => !r.designation_id))];
        } else {
          // keep each retained designation's current Wing; keep standalone Wing tags
          target = [...idsNew.map((id) => ({ designation_id: id, wing: curRows.find((r) => r.designation_id === id)?.wing || "" })), ...curRows.filter((r) => !r.designation_id)];
        }
        if (sameRows(target, curRows)) continue; // same set + Wings
        const vr = await validateRows(target, curRows);
        if (vr.error) { rec.errors.push(vr.error); continue; }
        newDesigIds = idsNew;
        rec.desig_rows = vr.rows;
        rec.changes.push({
          field: "designation", label: LABEL.designation,
          from: curRows.filter((r) => r.designation_id).map((r) => `${desigNameById.get(r.designation_id) || r.designation_id}${r.wing ? ` (${r.wing})` : ""}`).join(", "),
          to: vr.rows.filter((r) => r.designation_id).map((r) => `${desigNameById.get(r.designation_id)}${r.wing ? ` (${r.wing})` : ""}`).join(", "),
        });
      } else if (f === "wing") {
        continue; // handled together with Designation above
      } else if (f === "qualification" || f === "education_level") {
        if (rec._qDone) continue;
        rec._qDone = true;
        const qr = parseQualificationCells(idx.qualification !== undefined ? rec.raw[idx.qualification] : "", idx.education_level !== undefined ? rec.raw[idx.education_level] : "", cur);
        if (qr.unchanged) continue;
        if (qr.error) { rec.errors.push(qr.error); continue; }
        const cq = cur.qualification || null, ce = cur.education_level || null;
        if (qr.qualification !== cq) {
          rec.update.qualification = qr.qualification;
          rec.changes.push({ field: "qualification", label: LABEL.qualification, from: cq || "", to: qr.qualification === null ? "(cleared)" : qr.qualification, cleared: qr.qualification === null });
        }
        if (qr.education_level !== ce) {
          rec.update.education_level = qr.education_level;
          rec.changes.push({ field: "education_level", label: LABEL.education_level, from: ce ? E_SHOW[ce] || ce : "", to: qr.education_level === null ? "(cleared)" : E_SHOW[qr.education_level] || qr.education_level, cleared: false });
        }
      } else if (f === "vehicle") {
        const vr = parseVehicleCell(get(f));
        if (vr.unchanged) continue;
        if (vr.error) { rec.errors.push(vr.error); continue; }
        if ((cur.vehicle || null) !== vr.vehicle) {
          rec.update.vehicle = vr.vehicle;
          rec.changes.push({ field: "vehicle", label: LABEL.vehicle, from: cur.vehicle || "", to: vr.vehicle === null ? "(cleared)" : vr.vehicle, cleared: vr.vehicle === null });
        }
      } else if (f === "photo_url") {
        const v = cellStr(get(f));
        if (!v) continue;                                              // blank never removes the photo
        if (isClear(v)) { rec.errors.push("A photo cannot be removed by import"); continue; }
        if (v === (cur.photo_url || "")) continue;
        const pv = await validateContactPhotoUrl(v);
        if (pv.error) { rec.errors.push(pv.error); continue; }
        rec.update.photo_url = pv.url;
        rec.changes.push({ field: "photo_url", label: LABEL.photo_url, from: cur.photo_url || "", to: pv.url });
      } else if (f === "assigned_caller") {
        const v = cellStr(get(f));
        if (!v) continue;                                              // blank never unassigns
        if (isClear(v)) { rec.errors.push("Assigned Caller cannot be cleared by import"); continue; }
        const caller = callerByName.get(v.toLowerCase());
        if (!caller) { rec.errors.push(`"${v}" is not an active Caller`); continue; }
        if (String(cur.assigned_to_user_id ?? "") === String(caller.id)) continue;
        if (!opts.canAssign) { rec.errors.push("You are not allowed to assign contacts to a Caller"); continue; }
        rec.assign_to = caller.id;
        rec.changes.push({ field: "assigned_to_user_id", label: LABEL.assigned_to_user_id, from: cur.assigned_to_user_id ? (callerRows.find((c) => c.id === cur.assigned_to_user_id)?.username || `#${cur.assigned_to_user_id}`) : "", to: caller.username });
      } else if (f === "status") {
        const sr = parseStatusCell(get(f));
        if (sr.unchanged) continue;
        if (sr.error) { rec.errors.push(sr.error); continue; }
        if (Number(cur.is_completed || 0) === sr.is_completed) continue;
        if (!opts.canSetStatus) { rec.errors.push("You are not allowed to change a contact's Status"); continue; }
        rec.update.is_completed = sr.is_completed;
        rec.changes.push({ field: "is_completed", label: LABEL.is_completed, from: cur.is_completed ? "Done" : "Pending", to: sr.is_completed ? "Done" : "Pending" });
      } else if (f === "zone" || f === "lok_sabha" || f === "block") {
        const v = cellStr(get(f));
        if (!v) continue;
        if (isClear(v)) { rec.errors.push(`${LABEL[f === "zone" ? "zone_id" : f === "lok_sabha" ? "lok_sabha_id" : "ward_id"]} cannot be cleared`); continue; }
        rec[`_${f}`] = v;
      } else if (f === "district" || f === "assembly") {
        const v = cellStr(get(f));
        if (!v) continue;
        if (isClear(v)) { rec.errors.push(`${LABEL[f + "_id"]} cannot be cleared`); continue; }
        rec[`_${f}`] = v;
      }
    }
    // Geography: resolve district / assembly together so they stay consistent.
    const hadDistrict = !!rec._district;
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
          } else if (assemblyChanges && cur.ward_id && !rec._block) {
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
    // Zone / Lok Sabha / Block (own values on the contact). Each must exist and be consistent with the level above.
    if (!rec.errors.length && (rec._zone || rec._lok_sabha || rec._block)) {
      // The Zone / Lok Sabha a contact SHOWS is its own value, else the one its district belongs to. A cell that just
      // repeats that shown value (an exported sheet with only another column edited) is not a change and is ignored -
      // it must never conflict with, or override, an edit of the District etc. in the same row.
      const effLsCur0 = cur.lok_sabha_id || districtLs.get(cur.district_id) || null;
      const effZoneCur0 = cur.zone_id || (effLsCur0 ? lsZone.get(effLsCur0) : null) || null;
      let zid = rec._zone ? zoneByName.get(norm(rec._zone)) : null;
      let lid = rec._lok_sabha ? lsByName.get(norm(rec._lok_sabha)) : null;
      if (rec._zone && !zid) rec.errors.push(`Unknown zone "${rec._zone}"`);
      if (rec._lok_sabha && !lid) rec.errors.push(`Unknown Lok Sabha "${rec._lok_sabha}"`);
      if (zid && String(zid) === String(effZoneCur0)) zid = null;
      if (lid && String(lid) === String(effLsCur0)) lid = null;
      if (!rec.errors.length) {
        const zoneEff = zid || (rec.update.zone_id ?? cur.zone_id) || (cur.lok_sabha_id ? lsZone.get(cur.lok_sabha_id) : null) || null;
        if (lid && zoneEff && String(lsZone.get(lid) ?? "") !== String(zoneEff)) rec.errors.push(`Lok Sabha "${lsName.get(lid)}" is not in Zone "${zoneName.get(zoneEff) || zoneEff}"`);
        else if (lid && hadDistrict) {
          const dEff = rec.update.district_id ?? cur.district_id;
          if (dEff && String(districtLs.get(dEff) ?? "") !== String(lid)) rec.errors.push(`District "${districtName.get(dEff)}" is not in Lok Sabha "${lsName.get(lid)}"`);
        }
      }
      if (!rec.errors.length) {
        // The Zone / Lok Sabha a contact SHOWS is its own value, else the one its district belongs to - compare against that,
        // so an exported sheet (which carries the shown values) re-imports with no phantom change.
        const effLsCur = cur.lok_sabha_id || districtLs.get(cur.district_id) || null;
        const effZoneCur = cur.zone_id || (effLsCur ? lsZone.get(effLsCur) : null) || null;
        if (zid && have.has("zone_id") && String(effZoneCur ?? "") !== String(zid)) { rec.update.zone_id = zid; rec.changes = rec.changes.filter((c) => c.field !== "zone_id"); rec.changes.push({ field: "zone_id", label: LABEL.zone_id, from: zoneName.get(cur.zone_id) || "", to: zoneName.get(zid) }); }
        if (lid && have.has("lok_sabha_id") && String(effLsCur ?? "") !== String(lid)) { rec.update.lok_sabha_id = lid; rec.changes = rec.changes.filter((c) => c.field !== "lok_sabha_id"); rec.changes.push({ field: "lok_sabha_id", label: LABEL.lok_sabha_id, from: lsName.get(cur.lok_sabha_id) || "", to: lsName.get(lid) }); }
        if (rec._block) {
          const aEff = rec.update.assembly_id ?? cur.assembly_id;
          const wid = aEff ? wardByKey.get(`${aEff}|${norm(rec._block)}`) : null;
          if (!aEff) rec.errors.push(`Block "${rec._block}" needs the contact to have an Assembly`);
          else if (!wid) rec.errors.push(`Block "${rec._block}" does not exist under the contact's Assembly (${assemblyName.get(aEff) || aEff})`);
          else if (String(cur.ward_id ?? "") !== String(wid)) { rec.update.ward_id = wid; rec.changes.push({ field: "ward_id", label: LABEL.ward_id, from: wardName.get(cur.ward_id) || "", to: wardName.get(wid) }); }
        }
      }
    }
    delete rec._district; delete rec._assembly; delete rec._zone; delete rec._lok_sabha; delete rec._block; delete rec._qDone;
    if (newDesigIds) rec.designation_ids = newDesigIds;

    if (rec.errors.length) { rec.status = "error"; rec.changes = []; rec.update = {}; delete rec.designation_ids; delete rec.desig_rows; delete rec.assign_to; continue; }
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
    // "Assigned Caller": through the SAME assignment logic as the Contacts page (active caller, exclusions, row lock,
    // lock clearing, assigned_at / assigned_by stamping); a refusal fails just this row.
    let assignedNow = false;
    if (r.assign_to) {
      // eslint-disable-next-line no-await-in-loop
      const ar = await assignSingleContact(session, r.contact_id, r.assign_to);
      if (ar.status !== 200) { r.status = "failed"; r.errors.push(ar.message || "Could not assign the contact"); continue; }
      assignedNow = !!ar.changed;
    }
    if (!Object.keys(r.update || {}).length && !r.designation_ids) { if (r.assign_to) { r.status = "updated"; updated++; } continue; }
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
        // The designation set, each paired with its Wing, and the contact's Wing tags kept in step (union of the rows'
        // Wings, plus any main-organisation-named tag it already had) - same storage the Edit form writes.
        // eslint-disable-next-line no-await-in-loop
        await conn.query("DELETE FROM contact_designations WHERE contact_id = ?", [r.contact_id]);
        const rowsW = r.desig_rows || r.designation_ids.map((id) => ({ designation_id: id, wing: "" }));
        for (const row of rowsW.filter((x) => x.designation_id)) {
          // eslint-disable-next-line no-await-in-loop
          await conn.query("INSERT IGNORE INTO contact_designations (contact_id, designation_id, wing) VALUES (?, ?, ?)", [r.contact_id, row.designation_id, row.wing || null]);
        }
        if (r.desig_rows) {
          const [curW] = await conn.query("SELECT wing FROM contact_wings WHERE contact_id = ?", [r.contact_id]);
          const [mainRows] = await conn.query("SELECT name FROM wings WHERE is_main = 1");
          const mainLc = new Set(mainRows.map((m) => String(m.name).toLowerCase()));
          const keep = curW.map((w) => w.wing).filter((w) => mainLc.has(String(w).toLowerCase()));
          const wantW = [...new Set([...rowsW.map((x) => x.wing).filter(Boolean), ...keep])];
          // eslint-disable-next-line no-await-in-loop
          await conn.query("DELETE FROM contact_wings WHERE contact_id = ?", [r.contact_id]);
          for (const w of wantW) {
            // eslint-disable-next-line no-await-in-loop
            await conn.query("INSERT IGNORE INTO contact_wings (contact_id, wing) VALUES (?, ?)", [r.contact_id, w]);
          }
        }
      }
      if (r.update?.photo_url) { await conn.query("UPDATE contacts SET photo_verified = 1 WHERE id = ?", [r.contact_id]).catch(() => {}); }
      // eslint-disable-next-line no-await-in-loop
      await conn.commit();
      r.status = "updated";
      updated++;
      // Zone moved → release an assignment held by a caller of the OLD Zone (same rule as a
      // Contact Page edit), so the contact leaves that caller's queue too.
      // eslint-disable-next-line no-await-in-loop
      const zoneAfter = await contactEffectiveZoneId(r.contact_id).catch(() => zoneBefore);
      if (!assignedNow && String(zoneBefore ?? "") !== String(zoneAfter ?? "")) await releaseOutOfZoneAssignment(session, r.contact_id, zoneAfter).catch(() => {});
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

