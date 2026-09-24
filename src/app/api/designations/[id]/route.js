import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { logAudit, logMasterDataChange } from "@/lib/audit";
import { ensureDesignationLevelColumn, isValidDesignationLevel } from "@/lib/designationLevels";
import { ensureWingSchema } from "@/lib/wingDesignations";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "master_data", session && isAdmin(session)))) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const [prev] = await query("SELECT name, level FROM designations WHERE id = ?", [id]);
    const body = await req.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return Response.json({ message: "Name is required" }, { status: 400 });

    // Level and Wing are optional on edit — only updated when provided (keeps
    // existing callers that send just a name working). Level must be valid when given.
    const hasLevel = typeof body?.level === "string" && body.level.trim() !== "";
    const level = hasLevel ? body.level.trim() : null;
    if (hasLevel && !isValidDesignationLevel(level)) {
      return Response.json({ message: "Invalid level" }, { status: 400 });
    }
    const hasWing = body?.wing !== undefined; // empty string clears the wing
    const wing = hasWing ? (String(body.wing || "").trim() || null) : null;

    const sets = ["name = ?"];
    const args = [name];
    if (hasLevel) { await ensureDesignationLevelColumn(query); sets.push("level = ?"); args.push(level); }
    if (hasWing) { await ensureWingSchema(); sets.push("wing = ?"); args.push(wing); }
    const res = await query(`UPDATE designations SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
    if (res.affectedRows === 0) return Response.json({ message: "Not found" }, { status: 404 });
    await logMasterDataChange(session, {
      req, master: "designation", action: "Updated", recordId: id, recordName: name,
      before: { name: prev?.name ?? null, ...(hasLevel ? { level: prev?.level ?? null } : {}) },
      after: { name, ...(hasLevel ? { level } : {}), ...(hasWing ? { wing } : {}) },
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return Response.json({ message: "A designation with this name already exists" }, { status: 409 });
    }
    console.error("designation PUT error:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "master_data", session && isAdmin(session)))) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const [existing] = await query("SELECT name, level FROM designations WHERE id = ?", [id]);
    // calls.designation_id has ON DELETE SET NULL; clear contacts references too.
    await query("UPDATE contacts SET designation_id = NULL WHERE designation_id = ?", [id]);
    const res = await query("DELETE FROM designations WHERE id = ?", [id]);
    if (res.affectedRows === 0) return Response.json({ message: "Not found" }, { status: 404 });
    logAudit(session, { action: "designation.delete", entityType: "designation", entityId: id, details: existing || null });
    await logMasterDataChange(session, {
      req, master: "designation", action: "Deleted", recordId: id, recordName: existing?.name ?? null,
      before: existing ? { name: existing.name, level: existing.level } : null,
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return Response.json({ message: "This designation is in use and cannot be deleted" }, { status: 409 });
    }
    console.error("designation DELETE error:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
