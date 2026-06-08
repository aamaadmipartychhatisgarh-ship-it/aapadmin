import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import * as XLSX from "xlsx";

// Unified member import from Excel/CSV. Each member is added to BOTH:
//   - workers  (the org member record — always, phone optional)
//   - contacts (the calling pipeline — only if a phone is present + not a dup)
// so imported members show in the Workers list AND in Contact Records and can
// be assigned to callers.
//
// Handles the MEMBER LIST format:
//   S.NO | DATE | NAME | CONTACT NO | JILA | VIDHANSABHA | BLOCK | WARD
const COLUMN_MAP = {
  name: ["name", "member name", "full name"],
  mobile: ["contact no", "contact", "mobile", "phone", "phone number", "mobile no", "contact number"],
  district: ["jila", "district", "zila"],
  assembly: ["vidhansabha", "vidhan sabha", "assembly", "constituency"],
  block: ["block", "mandal"],
  ward: ["ward", "ward no", "ward number"],
  address: ["address", "village", "gram", "city"],
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

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ message: "No file uploaded" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    let wb;
    try {
      wb = XLSX.read(buf, { type: "buffer" });
    } catch {
      return NextResponse.json({ message: "Could not read the file. Use .xlsx, .xls, or .csv." }, { status: 400 });
    }

    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (rows.length < 2) {
      return NextResponse.json({ message: "Sheet has no data rows." }, { status: 400 });
    }

    const headerIdx = buildHeaderIndex(rows[0]);
    if (headerIdx.name === undefined) {
      return NextResponse.json({ message: "Could not find a NAME column in the sheet." }, { status: 400 });
    }

    const districtRows = await query("SELECT id, name FROM locations WHERE type = 'district'");
    const assemblyRows = await query("SELECT id, name FROM locations WHERE type = 'assembly'");
    const districtByName = new Map(districtRows.map((r) => [norm(r.name), r.id]));
    const assemblyByName = new Map(assemblyRows.map((r) => [norm(r.name), r.id]));
    const existingContactByPhone = new Map(
      (await query("SELECT id, phone_number FROM contacts")).map((r) => [String(r.phone_number), r.id])
    );

    // Existing workers keyed by mobile (for upsert). Rows with no mobile fall
    // back to matching by normalized name.
    const workerRows = await query("SELECT id, name, mobile FROM workers");
    const workerByMobile = new Map();
    const workerByName = new Map();
    for (const w of workerRows) {
      if (w.mobile) workerByMobile.set(String(w.mobile).replace(/[^\d+]/g, ""), w.id);
      else workerByName.set(norm(w.name), w.id);
    }

    const get = (row, field) => (headerIdx[field] !== undefined ? row[headerIdx[field]] : "");

    let workersInserted = 0;
    let workersUpdated = 0;
    let contactsInserted = 0;
    let contactsUpdated = 0;
    let skippedNoName = 0;
    let contactsSkippedNoPhone = 0;
    const seenPhones = new Set();
    const seenWorkerKeys = new Set();
    const unmatchedDistricts = new Set();
    const unmatchedAssemblies = new Set();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = String(get(row, "name") || "").trim();
      if (!name) { skippedNoName++; continue; }

      const phone = String(get(row, "mobile") || "").trim().replace(/[^\d+]/g, "") || null;

      const districtName = norm(get(row, "district"));
      const assemblyName = norm(get(row, "assembly"));
      const districtId = resolveLoc(districtName, districtByName, DISTRICT_ALIASES);
      const assemblyId = resolveLoc(assemblyName, assemblyByName, ASSEMBLY_ALIASES);
      if (districtName && !districtId) unmatchedDistricts.add(districtName);
      if (assemblyName && !assemblyId) unmatchedAssemblies.add(assemblyName);

      const block = String(get(row, "block") || "").trim();
      const ward = String(get(row, "ward") || "").trim();
      const addrCol = String(get(row, "address") || "").trim();
      const addressParts = [];
      if (addrCol) addressParts.push(addrCol);
      if (block) addressParts.push(`Block: ${block}`);
      if (ward) addressParts.push(`Ward: ${ward}`);
      const address = addressParts.join(", ") || null;

      // ---- WORKERS upsert (key = mobile, else name) ----
      const wKey = phone ? `m:${phone}` : `n:${norm(name)}`;
      // Skip exact duplicate rows within the same file.
      if (seenWorkerKeys.has(wKey)) {
        // still consider contacts below
      } else {
        seenWorkerKeys.add(wKey);
        const existingWorkerId = phone ? workerByMobile.get(phone) : workerByName.get(norm(name));
        if (existingWorkerId) {
          await query(
            `UPDATE workers SET name = ?, mobile = ?, address = ?, district_id = ?, assembly_id = ? WHERE id = ?`,
            [name, phone, address, districtId, assemblyId, existingWorkerId]
          );
          workersUpdated++;
        } else {
          const res = await query(
            `INSERT INTO workers (name, mobile, address, district_id, assembly_id, position, status)
             VALUES (?, ?, ?, ?, ?, 'Member', 'active')`,
            [name, phone, address, districtId, assemblyId]
          );
          // Track the new id so later rows in the same file dedupe to it.
          if (phone) workerByMobile.set(phone, res.insertId);
          else workerByName.set(norm(name), res.insertId);
          workersInserted++;
        }
      }

      // ---- CONTACTS upsert (key = phone; UNIQUE) ----
      if (!phone) {
        contactsSkippedNoPhone++;
      } else if (seenPhones.has(phone)) {
        // duplicate within this file — already handled
      } else {
        seenPhones.add(phone);
        if (existingContactByPhone.has(phone)) {
          // Update existing contact's details, but DON'T touch assignment/completion.
          await query(
            `UPDATE contacts SET person_name = ?, address = ?, district_id = ?, assembly_id = ? WHERE id = ?`,
            [name, address, districtId, assemblyId, existingContactByPhone.get(phone)]
          );
          contactsUpdated++;
        } else {
          const res = await query(
            `INSERT INTO contacts (person_name, phone_number, address, district_id, assembly_id)
             VALUES (?, ?, ?, ?, ?)`,
            [name, phone, address, districtId, assemblyId]
          );
          existingContactByPhone.set(phone, res.insertId);
          contactsInserted++;
        }
      }
    }

    return NextResponse.json({
      total_rows: rows.length - 1,
      workers_inserted: workersInserted,
      workers_updated: workersUpdated,
      contacts_inserted: contactsInserted,
      contacts_updated: contactsUpdated,
      contacts_skipped_no_phone: contactsSkippedNoPhone,
      skipped_no_name: skippedNoName,
      unmatched_districts: [...unmatchedDistricts],
      unmatched_assemblies: [...unmatchedAssemblies],
    });
  } catch (err) {
    console.error("import-excel error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
