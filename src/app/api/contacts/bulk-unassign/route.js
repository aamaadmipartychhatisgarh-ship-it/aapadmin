import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

// POST /api/contacts/bulk-unassign
// Body: { caller_ids?: number[] }  — empty/omitted = recall from ALL callers.
// Returns contacts to the pool (assigned_to_user_id = NULL) and resets them to
// pending (is_completed = 0) so they can be redistributed and called again.
// Releases any stale locks. Contacts are NOT deleted; call history is untouched.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const callerIds = Array.isArray(body.caller_ids) ? body.caller_ids.filter((n) => Number.isInteger(Number(n))) : [];

    // Affect all assigned contacts — including already-completed (Done) ones,
    // which the recall now returns to the pool and resets to pending.
    let where = "assigned_to_user_id IS NOT NULL";
    const params = [];
    if (callerIds.length > 0) {
      where += ` AND assigned_to_user_id IN (${callerIds.map(() => "?").join(",")})`;
      params.push(...callerIds);
    }

    const res = await query(
      `UPDATE contacts
          SET assigned_to_user_id = NULL,
              is_completed = 0,
              locked_by_user_id = NULL,
              locked_at = NULL,
              follow_up_date = NULL
        WHERE ${where}`,
      params
    );
    return NextResponse.json({ unassigned: res.affectedRows });
  } catch (err) {
    console.error("bulk-unassign error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
