import { query } from "@/lib/db";
import { WORKER_TYPES } from "@/lib/workerTypes";

// Shared parse + validate logic for the Worker Excel/CSV importer — used by
// BOTH the dry-run preview and the real commit (src/app/api/workers/
// import-excel/route.js) so the numbers shown in the preview modal are
// exactly what gets written, never a second, slightly different pass.
//
// Handles the MEMBER LIST format:
//   S.NO | DATE | NAME | CONTACT NO | JILA | VIDHANSABHA | BLOCK | WARD
// plus optional Designation / Membership No / Polling Booth columns.
const COLUMN_MAP = {
  name: ["name", "member name", "full name"],
  mobile: ["contact no", "contact", "mobile", "phone", "phone number", "mobile no", "contact number"],
  district: ["jila", "district", "zila"],
  assembly: ["vidhansabha", "vidhan sabha", "assembly", "constituency"],
  block: ["block", "mandal", "ward"], // "Block" in the product spec = the `ward` location type
  booth: ["polling booth", "polling station", "booth", "booth no", "booth number"],
  address: ["address", "village", "gram", "city"],
  designation: ["designation", "position", "role", "padasthapana"],
  membership_no: ["membership no", "membership number", "membership_no", "member id", "member no"],
  worker_type: ["worker type", "type", "employment type"],
};

function buildHeaderIndex(headerRow) {
  const idx = {};
  headerRow.forEach((h, i) => {
    const key = String(h || "").trim().toLowerCase();
    if (!key) return;
    for (const [field, names] of Object.entries(COLUMN_MAP)) {
      if (names.includes(key)) idx[field] = i;
    }
  });
  return idx;
}

function norm(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
}

// Map common spelling variants in member lists -> the canonical DB name (normalized).
const DISTRICT_ALIASES = {
  "BALODABAJAR": "BALODABAZAR-BHATAPARA",
  "BALODA BAZAR": "BALODABAZAR-BHATAPARA",
  "BALRAMPUR": "BALRAMPUR-RAMANUJGANJ",
  "GORELA-PENDRA-MARWAHI": "GAURELA-PENDRA-MARWAHI",
  "GORELLA-PENDRA-MARWAHI": "GAURELA-PENDRA-MARWAHI",
  "KHAIRGARH": "KHAIRAGARH-CHHUIKHADAN-GANDAI",
  "KORIYA": "KOREA",
  "RAIGADH": "RAIGARH",
  "SARGUJA": "SURGUJA",
  "SHAKTI": "SAKTI",
  "KAWARDHA": "KABEERDHAM",
  "KABIRDHAM": "KABEERDHAM",
  "DANTEWADA": "DAKSHIN BASTAR DANTEWADA",
  "KANKER": "UTTAR BASTAR KANKER",
};
const ASSEMBLY_ALIASES = {
  "BRINDANAWAGARH": "BINDRAWAGARH",
  "BINDRANAWAGARH": "BINDRAWAGARH",
  "DHARAMJAYGARH": "DHARAMJAIGARH",
  "DURG GRAMIN": "DURG RURAL",
  "KHARSIYA": "KHARSIA",
  "PALITANAKHAR": "PALI-TANAKHAR",
  "PALI TANAKHAR": "PALI-TANAKHAR",
  "RAIGADH": "RAIGARH",
  "RAIPUR NORTH": "RAIPUR CITY NORTH",
  "RAIPUR WEST": "RAIPUR CITY WEST",
  "RAIPUR SOUTH": "RAIPUR CITY SOUTH",
  "RAIPUR RURAL": "RAIPUR CITY RURAL",
  "RAMANUJAGANJ": "RAMANUJGANJ",
  "SARAYPALI": "SARAIPALI",
  "PRATAPUR": "PRATAPPUR",
};

function resolveLoc(name, byName, aliases) {
  if (!name) return null;
  if (byName.has(name)) return byName.get(name);
  const aliased = aliases[name];
  if (aliased && byName.has(aliased)) return byName.get(aliased);
  return null;
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
export async function parseAndValidateWorkbook(rows) {
  const headerIdx = buildHeaderIndex(rows[0]);
  if (headerIdx.name === undefined) {
    return { error: "Could not find a NAME column in the sheet." };
  }

  const [districtRows, assemblyRows, wardRows, boothRows, workerRows, membershipRows, contactRows] = await Promise.all([
    query("SELECT id, name FROM locations WHERE type = 'district'"),
    query("SELECT id, name FROM locations WHERE type = 'assembly'"),
    query("SELECT id, name, parent_id FROM locations WHERE type = 'ward'"),
    query("SELECT id, name, parent_id FROM locations WHERE type = 'booth'"),
    query("SELECT id, name, mobile FROM workers"),
    query("SELECT id, membership_no FROM workers WHERE membership_no IS NOT NULL"),
    query("SELECT id, phone_number FROM contacts"),
  ]);
  const existingContactByPhone = new Map(contactRows.map((r) => [String(r.phone_number), r.id]));
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
    if (phone) {
      if (seenMobiles.has(phone)) {
        summary.duplicate_mobile++;
        rowErrors.push({ row: rowNum, name, mobile: phone, severity: "error", reasons: [`Duplicate mobile — also row ${seenMobiles.get(phone)}`] });
        continue; // ambiguous which row should win — skip, don't silently pick one
      }
      seenMobiles.set(phone, rowNum);
    }

    const districtName = norm(get(row, "district"));
    const assemblyName = norm(get(row, "assembly"));
    const districtId = resolveLoc(districtName, districtByName, DISTRICT_ALIASES);
    const assemblyId = resolveLoc(assemblyName, assemblyByName, ASSEMBLY_ALIASES);
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
    if (headerIdx.designation !== undefined) {
      const desig = String(get(row, "designation") || "").trim();
      if (!desig) { summary.missing_designation++; reasons.push("Missing designation"); }
      else position = desig;
    }

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
      row: rowNum, name, phone, districtId, assemblyId, wardId, boothId, address,
      position, workerType, membershipNo,
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
  };
}

export { norm, buildHeaderIndex, resolveLoc, DISTRICT_ALIASES, ASSEMBLY_ALIASES };
