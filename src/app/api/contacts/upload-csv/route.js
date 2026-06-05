import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

// Accepts text/csv (or text/plain) body with header row:
//   person_name,phone_number,address,district_name,ward_name,booth_name
// district/ward/booth names are looked up in locations; unknown values become NULL.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { header: [], rows: [] };
  const header = splitRow(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((l) => {
    const cols = splitRow(l);
    const obj = {};
    header.forEach((h, i) => { obj[h] = (cols[i] || "").trim(); });
    return obj;
  });
  return { header, rows };
}

function splitRow(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

async function resolveLocation(name, type) {
  if (!name) return null;
  const rows = await query("SELECT id FROM locations WHERE name = ? AND type = ? LIMIT 1", [name, type]);
  return rows[0]?.id ?? null;
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const text = await req.text();
    const { header, rows } = parseCsv(text);
    if (!header.includes("person_name") || !header.includes("phone_number")) {
      return NextResponse.json({ message: "CSV must include person_name and phone_number columns" }, { status: 400 });
    }

    let inserted = 0;
    let duplicates = 0;
    const errors = [];

    for (const r of rows) {
      if (!r.person_name || !r.phone_number) continue;
      const districtId = await resolveLocation(r.district_name, "district");
      const wardId = await resolveLocation(r.ward_name, "ward");
      const boothId = await resolveLocation(r.booth_name, "booth");
      try {
        await query(
          `INSERT INTO contacts (person_name, phone_number, address, district_id, ward_id, booth_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [r.person_name, r.phone_number, r.address || null, districtId, wardId, boothId]
        );
        inserted++;
      } catch (e) {
        if (e.code === "ER_DUP_ENTRY") duplicates++;
        else errors.push({ phone: r.phone_number, error: e.message });
      }
    }

    return NextResponse.json({ inserted, duplicates, errors, total_rows: rows.length });
  } catch (err) {
    console.error("contacts upload-csv error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
