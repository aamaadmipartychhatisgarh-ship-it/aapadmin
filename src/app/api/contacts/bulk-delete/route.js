import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";

// Bulk-delete the "wrong number" contacts — those whose most recent call
// outcome was "Wrong Number". By design this endpoint ONLY ever targets that
// set (optionally narrowed to a district), so it can't be coaxed into wiping
// arbitrary contacts. Call history is preserved: calls.contact_id is
// ON DELETE SET NULL, so the calls stay, just unlinked.
//
// Body: { district_id?: number }
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));

    // Same predicate as the contacts list's ?wrong=1 view — keep in sync.
    // Latest call is Wrong Number AND the number hasn't since been corrected.
    let where = ` WHERE (
        SELECT csx.name FROM calls cx
          JOIN call_statuses csx ON csx.id = cx.status_id
         WHERE cx.contact_id = c.id
         ORDER BY cx.called_at DESC, cx.id DESC LIMIT 1
      ) = 'Wrong Number'
      AND (
        SELECT cx.phone_number FROM calls cx
         WHERE cx.contact_id = c.id
         ORDER BY cx.called_at DESC, cx.id DESC LIMIT 1
      ) = c.phone_number`;
    const params = [];
    if (body.district_id) { where += " AND c.district_id = ?"; params.push(body.district_id); }
    // Respect the admin's geographic scope.
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    const res = await query(`DELETE c FROM contacts c ${where}`, params);
    return NextResponse.json({ deleted: res.affectedRows || 0 });
  } catch (err) {
    console.error("contacts bulk-delete error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
