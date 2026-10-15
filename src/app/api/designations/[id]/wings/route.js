import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { ensureDesignationLevelColumn, isValidDesignationLevel } from "@/lib/designationLevels";
import { ensureWingSchema } from "@/lib/wingDesignations";
import { ensureDesignationWingsSchema, setDesignationWings } from "@/lib/designationWings";
import { logMasterDataChange } from "@/lib/audit";

// POST /api/designations/[id]/wings  { name?, level?, wings: [wingName, ...] }
//
// Saves ONE designation entry: its exact name, its Level (separate field) and the
// full set of Wings it belongs to (designation_wings). No sibling per-wing rows are
// created or deleted — the entry keeps its id, rank and assignments.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "master_data", session && isAdmin(session)))) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    await ensureDesignationLevelColumn(query);
    await ensureWingSchema();
    await ensureDesignationWingsSchema();

    const body = await req.json().catch(() => ({}));
    const [current] = await query("SELECT id, name, level, wing FROM designations WHERE id = ?", [id]);
    if (!current) return Response.json({ message: "Designation not found" }, { status: 404 });

    const level = (typeof body?.level === "string" && body.level.trim()) ? body.level.trim() : (current.level || null);
    if (!level || !isValidDesignationLevel(level)) {
      return Response.json({ message: "A valid Level is required" }, { status: 400 });
    }
    const name = (typeof body?.name === "string" && body.name.trim()) ? body.name.trim() : current.name;
    if (!name) return Response.json({ message: "Designation name is required" }, { status: 400 });

    const wings = Array.isArray(body?.wings) ? [...new Set(body.wings.map((w) => String(w || "").trim()).filter(Boolean))] : [];

    const [clash] = await query("SELECT id FROM designations WHERE name = ? AND level <=> ? AND id <> ? LIMIT 1", [name, level, id]);
    if (clash) return Response.json({ message: "A designation with this name already exists at this Level" }, { status: 409 });

    await query("UPDATE designations SET name = ?, level = ? WHERE id = ?", [name, level, id]);
    await setDesignationWings(id, wings);

    await logMasterDataChange(session, {
      req, master: "designation", action: "Updated Wings", recordId: id, recordName: name,
      before: { name: current.name, level: current.level },
      after: { name, level, wings },
    });
    return Response.json({ ok: true, base: name, level, wings, created: [], removed: [], keptAssigned: [], message: "Wings updated." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return Response.json({ message: "A designation with this name already exists" }, { status: 409 });
    }
    console.error("designation wings POST error:", error);
    return Response.json({ message: "Internal server error", detail: error?.sqlMessage || error?.message || null }, { status: 500 });
  }
}
