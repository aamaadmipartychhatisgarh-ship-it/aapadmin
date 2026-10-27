import { query } from "@/lib/db";
import { WORKER_TYPES } from "@/lib/workerTypes";
import { norm, DISTRICT_ALIASES, ASSEMBLY_ALIASES } from "@/lib/cgGeoAliases";
import { buildHeaderIndex } from "@/lib/importHeaders";
import { splitNameList } from "@/lib/contactFieldConfig";
import { parseQualificationCells, parseVehicleCell, parseStatusCell } from "@/lib/contactFieldParse";
import { validateContactPhotoUrl } from "@/lib/contactPhotoUrl";
import { validateRows } from "@/lib/contactDesignationRows";

// Shared parse + validate logic for the Contacts Excel/CSV importer
// (src/app/api/contacts/import-excel/route.js) — used by BOTH the dry-run
// preview and the real commit, so the numbers shown in the preview are
// exactly what gets written, never a second, slightly different pass.
// Despite the filename (this originally also matched against a `workers`
// table, before Worker Management was removed), the geo/name/mobile
// resolution logic here is domain-neutral, not worker-specific — kept as-is
// and reused for contacts rather than duplicated.
//
// Handles the MEMBER LIST format:
//   S.NO | DATE | NAME | CONTACT NO | JILA | VIDHANSABHA | BLOCK | WARD
// plus optional Designation / Membership No / Polling Booth columns.
// Canonical phone for duplicate comparison: strip everything non-digit and keep
// the last 10 digits, so all of "9876543210", "+91 9876543210", "91-9876543210"
// and "+919876543210" collapse to the same key "9876543210". Returns null when
// there are no digits. (Matches the last-10 rule the Contacts "duplicates"
// filter already uses.)
export function normalizePhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// norm() + the CG district/assembly spelling aliases moved to the shared
// src/lib/cgGeoAliases.js (single source of truth) so the polling importer reuses
// the EXACT same tables — re-exported below for back-compat with existing callers.

function resolveLoc(name, byName, aliases) {
  if (!name) return null;
  if (byName.has(name)) return byName.get(name);
  const aliased = aliases[name];
  if (aliased && byName.has(aliased)) return byName.get(aliased);
  return null;
}

// Worker Management was removed, so a deployed DB may no longer have the
// `workers` table (or its `membership_no` column). The contacts importer must
// NOT crash when they're absent — worker/membership matching is irrelevant to
// writing contacts and is simply skipped. Probed once per process, cached.
let _hasWorkersTable; // undefined = unknown
async function hasWorkersTable() {
  if (_hasWorkersTable !== undefined) return _hasWorkersTable;
  try {
    const rows = await query("SHOW TABLES LIKE 'workers'");
    _hasWorkersTable = rows.length > 0;
  } catch { _hasWorkersTable = false; }
  return _hasWorkersTable;
}
let _hasMembershipCol;
async function hasWorkersMembershipCol() {
  if (_hasMembershipCol !== undefined) return _hasMembershipCol;
  try {
    const rows = await query("SHOW COLUMNS FROM workers LIKE 'membership_no'");
    _hasMembershipCol = rows.length > 0;
  } catch { _hasMembershipCol = false; }
  return _hasMembershipCol;
}

const WORKER_TYPE_VALUES = new Set(WORKER_TYPES.map((t) => t.value));
function resolveWorkerType(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (!s) return null;
  if (WORKER_TYPE_VALUES.has(s)) return s;
  // Accept the human labels too ("Full Time Worker" -> full_time).
  const byLabel = WORKER_TYPES.find((t) => t.label.toLowerCase() === String(raw).trim().toLowerCase());
  return byLabel ? byLabel.value : null;
}

// Runs every DB lookup (locations, existing workers/contacts by key) and
// validates every row. Pure read — never writes. Returns:
//   validRows   rows that will be written on commit (name present, no
//               within-file duplicate mobile/membership)
//   rowErrors   EVERY row with an issue — both the hard ones above (which
//               block that row) and soft ones (unmatched geo, missing
//               designation) which still import but are flagged so the
//               admin can see and fix them via the error report
//   summary     aggregate counts for the preview UI
// opts.canAssign / opts.canSetStatus - as for Import Edit: the Assigned Caller / Status columns are applied only to
// users who may do that on the Contacts page (otherwise reported as a warning and ignored).
export async function parseAndValidateWorkbook(rows, opts = {}) {
  const headerIdx = buildHeaderIndex(rows[0]);
  if (headerIdx.name === undefined) {
    return { error: "Could not find a NAME column in the sheet." };
  }

  // The `workers` table + `membership_no` column are optional (Worker Management
  // was removed). Only query them when they still exist; otherwise the importer
  // skips worker/membership matching entirely — contacts still import normally.
  const workersExists = await hasWorkersTable();
  const membershipExists = workersExists && (await hasWorkersMembershipCol());
  const [callerRows, desigMaster] = await Promise.all([
    headerIdx.assigned_caller !== undefined ? query("SELECT id, username FROM users WHERE role = 'caller' AND (is_active IS NULL OR is_active = 1)") : Promise.resolve([]),
    headerIdx.designation !== undefined ? query("SELECT id, name FROM designations") : Promise.resolve([]),
  ]);
  const callerByName = new Map(callerRows.map((r) => [String(r.username).trim().toLowerCase(), r.id]));
  const desigKnown = new Set(desigMaster.map((d) => String(d.name).trim().toLowerCase()));
  const desigIdByName = new Map(desigMaster.map((d) => [String(d.name).trim().toLowerCase(), d.id]));
  const [zoneRows, lokSabhaRows, districtRows, assemblyRows, wardRows, boothRows, workerRows, membershipRows, contactRows] = await Promise.all([
    query("SELECT id, name FROM locations WHERE type = 'zone'"),
    query("SELECT id, name FROM locations WHERE type = 'lok_sabha'"),
    query("SELECT id, name FROM locations WHERE type = 'district'"),
    query("SELECT id, name FROM locations WHERE type = 'assembly'"),
    query("SELECT id, name, parent_id FROM locations WHERE type = 'ward'"),
    query("SELECT id, name, parent_id FROM locations WHERE type = 'booth'"),
    workersExists ? query("SELECT id, name, mobile FROM workers") : Promise.resolve([]),
    membershipExists ? query("SELECT id, membership_no FROM workers WHERE membership_no IS NOT NULL") : Promise.resolve([]),
    query("SELECT id, phone_number FROM contacts"),
  ]);
  const existingContactByPhone = new Map(contactRows.map((r) => [String(r.phone_number), r.id]));
  // Normalized set of EVERY existing contact phone — the bulk lookup the import
  // uses to skip contacts that already exist (regardless of stored format).
  const existingNormalizedPhones = new Set(contactRows.map((r) => normalizePhone(r.phone_number)).filter(Boolean));
  const zoneByName = new Map(zoneRows.map((r) => [norm(r.name), r.id]));
  const lokSabhaByName = new Map(lokSabhaRows.map((r) => [norm(r.name), r.id]));
  const districtByName = new Map(districtRows.map((r) => [norm(r.name), r.id]));
  const assemblyByName = new Map(assemblyRows.map((r) => [norm(r.name), r.id]));
  const wardByKey = new Map(wardRows.map((r) => [`${r.parent_id}|${norm(r.name)}`, r.id]));
  const boothByKey = new Map(boothRows.map((r) => [`${r.parent_id}|${norm(r.name)}`, r.id]));
  const workerByMobile = new Map();
  const workerByName = new Map();
  for (const w of workerRows) {
    if (w.mobile) workerByMobile.set(String(w.mobile).replace(/[^\d+]/g, ""), w.id);
    else workerByName.set(norm(w.name), w.id);
  }
  const membershipToWorker = new Map(membershipRows.map((r) => [r.membership_no, r.id]));

  const get = (row, field) => (headerIdx[field] !== undefined ? row[headerIdx[field]] : "");

  const validRows = [];
  const rowErrors = [];
  const seenMobiles = new Map(); // mobile -> first row number seen at
  const seenMemberships = new Map();
  const summary = {
    invalid_district: 0, invalid_assembly: 0, invalid_block: 0, invalid_booth: 0,
    missing_designation: 0, duplicate_mobile: 0, duplicate_membership: 0, missing_name: 0,
  };
  const unmatchedDistricts = new Set();
  const unmatchedAssemblies = new Set();

  for (let i = 1; i < rows.length; i++) {
    const rowNum = i + 1; // 1-based, matches the row number as seen in Excel (header = row 1)
    const row = rows[i];
    const name = String(get(row, "name") || "").trim();
    const reasons = [];
    let severity = "warning"; // escalates to "error" (row not written) below

    if (!name) {
      summary.missing_name++;
      rowErrors.push({ row: rowNum, name: "", mobile: "", severity: "error", reasons: ["Missing name"] });
      continue; // unidentifiable — nothing else about this row can be trusted
    }

    const phone = String(get(row, "mobile") || "").trim().replace(/[^\d+]/g, "") || null;
    // Canonical key for de-duplication (handles +91 / 91 / spaces / dashes).
    const phoneKey = normalizePhone(phone);
    if (phoneKey) {
      if (seenMobiles.has(phoneKey)) {
        // Same phone appears earlier in THIS file — keep the first, skip this one.
        // Classified as a DUPLICATE (not invalid), so it lands in the summary's
        // "Duplicate" bucket, matching the same-file de-dup requirement.
        summary.duplicate_mobile++;
        rowErrors.push({ row: rowNum, name, mobile: phone, severity: "duplicate", reasons: [`Duplicate of row ${seenMobiles.get(phoneKey)} in this file (same phone)`] });
        continue;
      }
      seenMobiles.set(phoneKey, rowNum);
    }

    const zoneName = norm(get(row, "zone"));
    const lokSabhaName = norm(get(row, "lok_sabha"));
    const districtName = norm(get(row, "district"));
    const assemblyName = norm(get(row, "assembly"));
    const zoneId = zoneName ? (zoneByName.get(zoneName) || null) : null;
    const lokSabhaId = lokSabhaName ? (lokSabhaByName.get(lokSabhaName) || null) : null;
    const districtId = resolveLoc(districtName, districtByName, DISTRICT_ALIASES);
    const assemblyId = resolveLoc(assemblyName, assemblyByName, ASSEMBLY_ALIASES);
    if (zoneName && !zoneId) reasons.push(`Invalid zone "${get(row, "zone")}"`);
    if (lokSabhaName && !lokSabhaId) reasons.push(`Invalid lok sabha "${get(row, "lok_sabha")}"`);
    if (districtName && !districtId) { summary.invalid_district++; unmatchedDistricts.add(districtName); reasons.push(`Invalid district "${get(row, "district")}"`); }
    if (assemblyName && !assemblyId) { summary.invalid_assembly++; unmatchedAssemblies.add(assemblyName); reasons.push(`Invalid assembly "${get(row, "assembly")}"`); }

    const blockRaw = String(get(row, "block") || "").trim();
    const boothRaw = String(get(row, "booth") || "").trim();
    const wardId = blockRaw && assemblyId ? (wardByKey.get(`${assemblyId}|${norm(blockRaw)}`) || null) : null;
    if (blockRaw && !wardId) { summary.invalid_block++; reasons.push(`Invalid block "${blockRaw}"`); }
    const boothId = boothRaw && wardId ? (boothByKey.get(`${wardId}|${norm(boothRaw)}`) || null) : null;
    if (boothRaw && !boothId) { summary.invalid_booth++; reasons.push(`Invalid polling booth "${boothRaw}"`); }

    // Designation is only validated when the file actually has the column —
    // old-format files with no Designation column keep defaulting to "Member"
    // with no per-row warning, matching the importer's historical behavior.
    let position = "Member";
    let desigNames = null; // several KNOWN designations in one cell (e.g. an exported sheet)
    if (headerIdx.designation !== undefined) {
      const desig = String(get(row, "designation") || "").trim();
      if (!desig) { summary.missing_designation++; reasons.push("Missing designation"); }
      else {
        position = desig;
        const parts = [...new Set(splitNameList(desig, desigKnown))];
        if (parts.length > 1 && parts.every((n) => desigKnown.has(n.toLowerCase()))) { desigNames = parts; position = parts[0]; }
      }
    }
    // ---- the Contact Edit form's remaining fields (soft: an invalid value is reported and skipped, the contact still imports)
    const extra = {};
    const cellOf = (f) => String(get(row, f) ?? "").trim();
    if (headerIdx.remarks !== undefined && cellOf("remarks") && cellOf("remarks").toLowerCase() !== "[clear]") extra.remarks = cellOf("remarks").slice(0, 2000);
    if (headerIdx.pincode !== undefined && cellOf("pincode")) { if (/^\d{6}$/.test(cellOf("pincode"))) extra.pincode = cellOf("pincode"); else reasons.push(`Invalid pincode "${cellOf("pincode")}" (6 digits) — ignored`); }
    if (headerIdx.village_city !== undefined && cellOf("village_city")) extra.village = cellOf("village_city").slice(0, 100);
    if (headerIdx.qualification !== undefined || headerIdx.education_level !== undefined) {
      const q = parseQualificationCells(headerIdx.qualification !== undefined ? get(row, "qualification") : "", headerIdx.education_level !== undefined ? get(row, "education_level") : "");
      if (q.error) reasons.push(`${q.error} — qualification ignored`);
      else if (!q.unchanged && q.qualification) { extra.qualification = q.qualification; extra.education_level = q.education_level; }
    }
    if (headerIdx.vehicle !== undefined) {
      const v = parseVehicleCell(get(row, "vehicle"));
      if (v.error) reasons.push(`${v.error} — ignored`); else if (!v.unchanged && v.vehicle) extra.vehicle = v.vehicle;
    }
    if (headerIdx.photo_url !== undefined && cellOf("photo_url") && cellOf("photo_url").toLowerCase() !== "[clear]") {
      const pv = await validateContactPhotoUrl(cellOf("photo_url"));
      if (pv.error) reasons.push(`${pv.error} — photo ignored`); else extra.photo_url = pv.url;
    }
    if (headerIdx.assigned_caller !== undefined && cellOf("assigned_caller")) {
      const cid = callerByName.get(cellOf("assigned_caller").toLowerCase());
      if (!cid) reasons.push(`"${cellOf("assigned_caller")}" is not an active Caller — not assigned`);
      else if (!opts.canAssign) reasons.push("You are not allowed to assign contacts — Assigned Caller ignored");
      else extra.assigned_to_user_id = cid;
    }
    if (headerIdx.status !== undefined) {
      const st = parseStatusCell(get(row, "status"));
      if (st.error) reasons.push(`${st.error} — ignored`);
      else if (!st.unchanged && st.is_completed === 1) { if (opts.canSetStatus) extra.is_completed = 1; else reasons.push("You are not allowed to set Status — ignored"); }
    }
    // Wing of each designation (aligned by position); needs designations that exist in Master Data.
    let desigRows = null;
    if (headerIdx.wing !== undefined && cellOf("wing") && headerIdx.designation !== undefined) {
      const names = desigNames || (desigKnown.has(position.toLowerCase()) ? [position] : null);
      if (!names) reasons.push("Wing ignored — the designation is not in Master Data yet");
      else {
        const wl = cellOf("wing").split(/[;,|]/).map((x) => x.trim());
        if (wl.length < names.length) reasons.push(`Wing list has fewer entries than designations — Wing ignored`);
        else {
          const rowsW = names.map((n, i) => ({ designation_id: desigIdByName.get(n.toLowerCase()), wing: wl[i] && wl[i].toLowerCase() !== "main organisation" ? wl[i] : "" }));
          const extras = wl.slice(names.length).filter((w) => w && w.toLowerCase() !== "main organisation").map((w) => ({ designation_id: null, wing: w }));
          const vr = await validateRows([...rowsW, ...extras], []);
          if (vr.error) reasons.push(`${vr.error} — Wing ignored`); else desigRows = vr.rows;
        }
      }
    }
    if (!desigRows && desigNames) desigRows = desigNames.map((n) => ({ designation_id: desigIdByName.get(n.toLowerCase()), wing: "" }));

    const workerType = headerIdx.worker_type !== undefined ? resolveWorkerType(get(row, "worker_type")) : null;
    if (headerIdx.worker_type !== undefined && get(row, "worker_type") && !workerType) {
      reasons.push(`Unrecognized worker type "${get(row, "worker_type")}"`);
    }

    let membershipNo = headerIdx.membership_no !== undefined ? String(get(row, "membership_no") || "").trim() || null : null;
    if (membershipNo) {
      const existingOwner = membershipToWorker.get(membershipNo);
      const thisWorkerId = phone ? workerByMobile.get(phone) : workerByName.get(norm(name));
      if (seenMemberships.has(membershipNo)) {
        summary.duplicate_membership++;
        rowErrors.push({ row: rowNum, name, mobile: phone || "", severity: "error", reasons: [`Duplicate membership no — also row ${seenMemberships.get(membershipNo)}`] });
        continue;
      }
      if (existingOwner && existingOwner !== thisWorkerId) {
        summary.duplicate_membership++;
        rowErrors.push({ row: rowNum, name, mobile: phone || "", severity: "error", reasons: [`Membership no already used by another worker (ID ${existingOwner})`] });
        continue;
      }
      seenMemberships.set(membershipNo, rowNum);
    }

    const addrCol = String(get(row, "address") || "").trim();
    const addressParts = [];
    if (addrCol) addressParts.push(addrCol);
    if (blockRaw && !wardId) addressParts.push(`Block: ${blockRaw}`); // resolved blocks go to ward_id instead
    if (boothRaw && !boothId) addressParts.push(`Booth: ${boothRaw}`);
    const address = addressParts.join(", ") || null;

    if (reasons.length) rowErrors.push({ row: rowNum, name, mobile: phone || "", severity: "warning", reasons });

    validRows.push({
      row: rowNum, name, phone, phoneKey, zoneId, lokSabhaId, districtId, assemblyId, wardId, boothId, address,
      position, workerType, membershipNo, extra, desigRows,
    });
  }

  return {
    headerIdx,
    validRows,
    rowErrors,
    summary,
    totalRows: rows.length - 1,
    unmatchedDistricts: [...unmatchedDistricts],
    unmatchedAssemblies: [...unmatchedAssemblies],
    // Reused by the commit path so it doesn't re-run the same lookups.
    workerByMobile,
    workerByName,
    existingContactByPhone,
    existingNormalizedPhones,
  };
}

export { norm, buildHeaderIndex, resolveLoc, DISTRICT_ALIASES, ASSEMBLY_ALIASES };
