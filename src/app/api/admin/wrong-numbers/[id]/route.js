import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { hasWrongNumberColumn } from "@/lib/contactExtras";

// POST /api/admin/wrong-numbers/[id]  { action: "restore" | "reassign", user_id? }
// Supervisor / Team Leader / Super Admin.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const { action, user_id } = await req.json().catch(() => ({}));

    if (action === "restore") {
      if (!(await hasWrongNumberColumn())) {
        return NextResponse.json({ message: "Wrong Number feature not enabled." }, { status: 400 });
      }
      // Clear the flag + completion and locks so it returns to the active queue.
      await query(
        `UPDATE contacts
            SET is_wrong_number = 0, is_completed = 0,
                locked_by_user_id = NULL, locked_at = NULL
          WHERE id = ?`,
        [id]
      );
      return NextResponse.json({ message: "Restored to the calling queue." });
    }

    if (action === "reassign") {
      if (!user_id) return NextResponse.json({ message: "user_id required" }, { status: 400 });
      await query(
        `UPDATE contacts SET assigned_to_user_id = ?, assigned_at = NOW(), locked_by_user_id = NULL, locked_at = NULL WHERE id = ?`,
        [user_id, id]
      );
      return NextResponse.json({ message: "Contact reassigned." });
    }

    return NextResponse.json({ message: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("wrong-numbers action error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/admin/wrong-numbers/[id] — admin only.
export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Only admins can delete records." }, { status: 401 });
    }
    const { id } = await params;
    await query("DELETE FROM contacts WHERE id = ?", [id]);
    return NextResponse.json({ message: "Record deleted." });
  } catch (err) {
    console.error("wrong-numbers DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
