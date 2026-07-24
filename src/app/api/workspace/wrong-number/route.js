import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import { hasWrongNumberColumn } from "@/lib/contactExtras";

// POST { contact_id }: manually clear a contact's Wrong Number flag and return
// it to the caller's active queue. Only the caller it's assigned to can do this.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (isOversight(session)) {
      return NextResponse.json({ message: "Only callers manage their queue." }, { status: 403 });
    }
    if (!(await hasWrongNumberColumn())) {
      return NextResponse.json({ message: "Wrong Number list is not enabled yet." }, { status: 400 });
    }
    const { contact_id } = await req.json().catch(() => ({}));
    if (!contact_id) {
      return NextResponse.json({ message: "contact_id is required" }, { status: 400 });
    }

    const res = await query(
      `UPDATE contacts
          SET is_wrong_number = 0, is_completed = 0,
              locked_by_user_id = NULL, locked_at = NULL
        WHERE id = ? AND assigned_to_user_id = ?`,
      [contact_id, session.user.id]
    );
    if (!res.affectedRows) {
      return NextResponse.json({ message: "Contact not found in your queue." }, { status: 404 });
    }
    return NextResponse.json({ message: "Restored to queue." });
  } catch (err) {
    console.error("wrong-number restore error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
