import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import * as XLSX from "xlsx";

// Import members from an Excel (.xlsx/.xls) or CSV file into `workers`.
//
// Expected columns (header row, case/space-insensitive). Handles the
// MEMBER LIST format: S.NO | DATE | NAME | CONTACT NO | JILA | VIDHANSABHA | BLOCK | WARD
// Synonyms accepted so other sheets work too.
const COLUMN_MAP = {
  name: ["name", "member name", "full name"],
  mobile: ["contact no", "contact", "mobile", "phone", "phone number", "mobile no", "contact number"],
  district: ["jila", "district", "zila"],
  assembly: ["vidhansabha", "vidhan sabha", "assembly", "constituency"],
  block: ["block", "mandal"],
  ward: ["ward", "ward no", "ward number"],
  address: ["address", "village", "gram", "city"],
};

// Build a lookup: header text -> our canonical field.
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

// Normalize a name for matching (trim, collapse spaces, upper-case).
function norm(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
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
      return NextResponse.json(
        { message: "Could not find a NAME column in the sheet." },
        { status: 400 }
      );
    }

    // Preload locations once (name -> id), so we don't query per row.
    const districtRows = await query(
      "SELECT id, name FROM locations WHERE type = 'district'"
    );
    const assemblyRows = await query(
      "SELECT id, name FROM locations WHERE type = 'assembly'"
    );
    const districtByName = new Map(districtRows.map((r) => [norm(r.name), r.id]));
    const assemblyByName = new Map(assemblyRows.map((r) => [norm(r.name), r.id]));

    const get = (row, field) =>
      headerIdx[field] !== undefined ? row[headerIdx[field]] : "";

    let inserted = 0;
    let skipped = 0;
    const unmatchedDistricts = new Set();
    const unmatchedAssemblies = new Set();

    // Build address from block + ward when no explicit address column.
    const VALUES = [];
    const params = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = String(get(row, "name") || "").trim();
      if (!name) { skipped++; continue; }

      const mobileRaw = String(get(row, "mobile") || "").trim();
      const mobile = mobileRaw ? mobileRaw.replace(/[^\d+]/g, "") : null;

      const districtName = norm(get(row, "district"));
      const assemblyName = norm(get(row, "assembly"));
      const districtId = districtName ? districtByName.get(districtName) ?? null : null;
      const assemblyId = assemblyName ? assemblyByName.get(assemblyName) ?? null : null;
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

      VALUES.push("(?, ?, ?, ?, ?, 'Member', 'active')");
      params.push(name, mobile, address, districtId, assemblyId);
      inserted++;

      // Flush in batches of 500 to keep queries fast and within packet limits.
      if (VALUES.length >= 500) {
        await query(
          `INSERT INTO workers (name, mobile, address, district_id, assembly_id, position, status)
           VALUES ${VALUES.join(", ")}`,
          params
        );
        VALUES.length = 0;
        params.length = 0;
      }
    }

    if (VALUES.length) {
      await query(
        `INSERT INTO workers (name, mobile, address, district_id, assembly_id, position, status)
         VALUES ${VALUES.join(", ")}`,
        params
      );
    }

    return NextResponse.json({
      inserted,
      skipped,
      total_rows: rows.length - 1,
      unmatched_districts: [...unmatchedDistricts],
      unmatched_assemblies: [...unmatchedAssemblies],
    });
  } catch (err) {
    console.error("workers import-excel error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
