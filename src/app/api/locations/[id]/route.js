import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

// PUT: rename a location and/or move it under a different parent
// (e.g. shift a Lok Sabha to another Zone). Children move along with it.
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const d = await req.json();
    const sets = [], vals = [];
    if ("name" in d) {
      if (!d.name) return Response.json({ message: "Name is required" }, { status: 400 });
      sets.push("name = ?"); vals.push(d.name);
    }
    if ("parent_id" in d) {
      if (String(d.parent_id) === String(id)) {
        return Response.json({ message: "A location cannot be its own parent" }, { status: 400 });
      }
      sets.push("parent_id = ?"); vals.push(d.parent_id || null);
    }
    if (!sets.length) return Response.json({ message: "No fields to update" }, { status: 400 });
    vals.push(id);
    const res = await query(`UPDATE locations SET ${sets.join(", ")} WHERE id = ?`, vals);
    if (res.affectedRows === 0) return Response.json({ message: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("location PUT error:", error);
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
    const [{ n }] = await query("SELECT COUNT(*) AS n FROM locations WHERE parent_id = ?", [id]);
    if (Number(n) > 0) {
      return Response.json({ message: `This location has ${n} sub-location(s). Move or delete them first.` }, { status: 409 });
    }
    const res = await query("DELETE FROM locations WHERE id = ?", [id]);
    if (res.affectedRows === 0) return Response.json({ message: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return Response.json({ message: "This location is used by existing records (workers/contacts/etc.) and cannot be deleted." }, { status: 409 });
    }
    console.error("location DELETE error:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
