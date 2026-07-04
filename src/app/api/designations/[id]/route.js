import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const { name } = await req.json();
    if (!name) return Response.json({ message: "Name is required" }, { status: 400 });
    const res = await query("UPDATE designations SET name = ? WHERE id = ?", [name, id]);
    if (res.affectedRows === 0) return Response.json({ message: "Not found" }, { status: 404 });
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
    if (!session || !isAdmin(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    // calls.designation_id has ON DELETE SET NULL; clear contacts references too.
    await query("UPDATE contacts SET designation_id = NULL WHERE designation_id = ?", [id]);
    const res = await query("DELETE FROM designations WHERE id = ?", [id]);
    if (res.affectedRows === 0) return Response.json({ message: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return Response.json({ message: "This designation is in use and cannot be deleted" }, { status: 409 });
    }
    console.error("designation DELETE error:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
