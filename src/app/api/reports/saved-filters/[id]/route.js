import { NextResponse as Response } from "next/server";
import { query } from "@/lib/db";
import { reportsGuard as guard } from "@/lib/reports/guard";

// DELETE /api/reports/saved-filters/:id — only the owner can delete their own saved view.
export async function DELETE(req, { params }) {
  const { session, error } = await guard();
  if (error) return error;
  const { id } = await params;
  const res = await query("DELETE FROM saved_reports WHERE id = ? AND user_id = ?", [id, session.user.id]);
  if (!res.affectedRows) return Response.json({ message: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
