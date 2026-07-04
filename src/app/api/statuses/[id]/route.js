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
    const res = await query("UPDATE call_statuses SET name = ? WHERE id = ?", [name, id]);
    if (res.affectedRows === 0) return Response.json({ message: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return Response.json({ message: "A status with this name already exists" }, { status: 409 });
    }
    console.error("status PUT error:", error);
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
    // Refuse deletion when existing calls use this status — deleting would
    // orphan/erase their outcome. Rename it instead.
    const [{ n }] = await query("SELECT COUNT(*) AS n FROM calls WHERE status_id = ?", [id]);
    if (Number(n) > 0) {
      return Response.json({ message: `This status is used by ${n} call(s). Rename it instead of deleting.` }, { status: 409 });
    }
    const res = await query("DELETE FROM call_statuses WHERE id = ?", [id]);
    if (res.affectedRows === 0) return Response.json({ message: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return Response.json({ message: "This status is in use and cannot be deleted" }, { status: 409 });
    }
    console.error("status DELETE error:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
