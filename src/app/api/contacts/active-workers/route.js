import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { scopeFilterSync } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { notWrongNumberClause, notNotInterestedClause } from "@/lib/contactExtras";
import { normalizeActiveStatus } from "@/lib/activeStatus";

// The Active Status lives on users.active_status (the ONE authoritative value,
// shared with the caller's Log Outcome display). Ensure the column exists before
// reading/writing it here — the same lazy guard the workspace route uses.
let ensuredCol = false;
async function ensureActiveStatusColumn() {
  if (ensuredCol) return;
  try {
    const rows = await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'active_status'`
    );
    if (Number(rows[0]?.n || 0) === 0) {
      await query(`ALTER TABLE users ADD COLUMN active_status VARCHAR(20) NULL`);
    }
    ensuredCol = true;
  } catch (e) {
    console.error("[active-workers] ensureActiveStatusColumn:", e?.message || e);
  }
}

// GET /api/contacts/active-workers
// User-wise Active Workers = contacts ASSIGNED to a caller and still active
// (assigned_to_user_id IS NOT NULL, and NOT a wrong number — the same
// "reachable" definition the Contacts list uses), grouped by the caller.
// A single backend GROUP BY, so the counts reflect the COMPLETE authorized
// dataset (never a paginated subset) and honour the caller's role/territory
// scope and Page Access exactly like the Contacts list.
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isSupervisor(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureActiveStatusColumn();
    const { searchParams } = new URL(req.url);
    const search = (searchParams.get("search") || "").trim();
    const district_id = searchParams.get("district_id");
    const assembly_id = searchParams.get("assembly_id");

    let where = " WHERE c.assigned_to_user_id IS NOT NULL";
    const params = [];
    // "Active" excludes wrong-number contacts — identical rule to the list.
    where += await notWrongNumberClause("c");
    where += await notNotInterestedClause("c");
    if (district_id) { where += " AND c.district_id = ?"; params.push(district_id); }
    if (assembly_id) { where += " AND c.assembly_id = ?"; params.push(assembly_id); }
    if (search) { where += " AND u.username LIKE ?"; params.push(`%${search}%`); }
    // Same non-bypassable geographic/role scope the Contacts list applies.
    const scope = scopeFilterSync(session.user, "c");
    where += " " + scope.where;
    params.push(...scope.params);

    const rows = await query(
      `SELECT c.assigned_to_user_id AS user_id, u.username, u.active_status,
              COUNT(*) AS active_count,
              COALESCE(SUM(c.is_completed = 1), 0) AS done_count,
              COALESCE(SUM(c.is_completed = 0), 0) AS pending_count
         FROM contacts c
         JOIN users u ON u.id = c.assigned_to_user_id
        ${where}
        GROUP BY c.assigned_to_user_id, u.username, u.active_status
        ORDER BY active_count DESC, u.username ASC`,
      params
    );

    const groups = rows.map((r) => ({
      user_id: r.user_id,
      username: r.username,
      active_status: r.active_status || null, // the ONE authoritative value (users.active_status)
      active_count: Number(r.active_count) || 0,
      done_count: Number(r.done_count) || 0,
      pending_count: Number(r.pending_count) || 0,
    }));
    const total = groups.reduce((a, g) => a + g.active_count, 0);
    return NextResponse.json({ groups, total, callers: groups.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("active-workers GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// POST /api/contacts/active-workers  { user_id, active_status }
// Add/update ONE worker's Active Status. This is the authoritative place the
// status is managed (§2). Gated by the SAME permission as the page itself
// (Page Access "contacts" + supervisor/admin) — so no one gains edit rights just
// because the page exists, and the caller's own calling permissions are untouched.
// Writes users.active_status (the single authoritative value the Log Outcome
// display reads back), never a duplicate field.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isSupervisor(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureActiveStatusColumn();
    const body = await req.json().catch(() => ({}));
    const userId = Number(body?.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ message: "A valid user is required." }, { status: 400 });
    }
    const value = normalizeActiveStatus(body?.active_status);
    if (!value) {
      return NextResponse.json({ message: "Invalid active status." }, { status: 400 });
    }
    const res = await query(`UPDATE users SET active_status = ? WHERE id = ?`, [value, userId]);
    if (!res?.affectedRows) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }
    const [row] = await query(`SELECT active_status FROM users WHERE id = ?`, [userId]);
    return NextResponse.json(
      { ok: true, user_id: userId, active_status: row?.active_status || value },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("active-workers POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
