import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { blocksForAssembly, isAssembly, normalizeBlockName } from "@/lib/politicalLocation";

// GET /api/assemblies/{id}/blocks — the Assembly → Block dependent dropdown (§11).
// Returns ONLY the Blocks mapped to this assembly (by the stored parent_id), so
// callers never fetch all blocks and filter on the client. Any signed-in user may
// read (dropdowns are used across forms/filters).
export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const blocks = await blocksForAssembly(id);
    return NextResponse.json({ assembly_id: Number(id), blocks });
  } catch (e) {
    console.error("assembly blocks GET error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// POST /api/assemblies/{id}/blocks — add a Block to THIS assembly (admin). Assembly
// is mandatory and validated (§6/§12); a duplicate block name within the same
// assembly is rejected (normalised compare, §14), while the same name under a
// DIFFERENT assembly is allowed (§15). Returns the created block.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const assemblyId = Number(id);
    if (!(await isAssembly(assemblyId))) {
      return NextResponse.json({ message: "Select a valid Assembly first." }, { status: 400 });
    }
    const d = await req.json().catch(() => ({}));
    const name = String(d?.name || "").replace(/\s+/g, " ").trim();
    const nameHi = String(d?.name_hi || "").replace(/\s+/g, " ").trim() || null;
    if (!name) return NextResponse.json({ message: "Block name is required." }, { status: 400 });

    const existing = await query(`SELECT name FROM locations WHERE type = 'ward' AND parent_id = ?`, [assemblyId]);
    if (existing.some((r) => normalizeBlockName(r.name) === normalizeBlockName(name))) {
      return NextResponse.json({ message: `"${name}" already exists as a Block in this Assembly.` }, { status: 409 });
    }
    const res = await query(
      `INSERT INTO locations (type, name, name_hi, parent_id, status) VALUES ('ward', ?, ?, ?, 'active')`,
      [name.slice(0, 190), nameHi ? nameHi.slice(0, 190) : null, assemblyId]
    );
    return NextResponse.json({ id: res.insertId, name_en: name, name_hi: nameHi, status: "active" }, { status: 201 });
  } catch (e) {
    console.error("assembly blocks POST error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
