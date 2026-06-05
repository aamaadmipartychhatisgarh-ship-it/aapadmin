import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

// CSV header: name,mobile,address,district_name,assembly_name,position,skills,status
function splitRow(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { q = !q; continue; }
    if (ch === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur); return out;
}

async function loc(name, type) {
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
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return NextResponse.json({ message: "CSV needs a header + rows" }, { status: 400 });
    const header = splitRow(lines[0]).map((h) => h.trim().toLowerCase());
    if (!header.includes("name")) return NextResponse.json({ message: "CSV must include a 'name' column" }, { status: 400 });

    let inserted = 0;
    for (const line of lines.slice(1)) {
      const cols = splitRow(line);
      const row = {};
      header.forEach((h, i) => { row[h] = (cols[i] || "").trim(); });
      if (!row.name) continue;
      const districtId = await loc(row.district_name, "district");
      const assemblyId = await loc(row.assembly_name, "assembly");
      await query(
        `INSERT INTO workers (name, mobile, address, district_id, assembly_id, position, skills, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.name, row.mobile || null, row.address || null, districtId, assemblyId,
         row.position || null, row.skills || null, row.status === "inactive" ? "inactive" : "active"]
      );
      inserted++;
    }
    return NextResponse.json({ inserted, total_rows: lines.length - 1 });
  } catch (err) {
    console.error("workers upload-csv error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
