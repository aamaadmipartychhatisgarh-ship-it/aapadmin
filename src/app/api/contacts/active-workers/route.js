import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { normalizeActiveStatus } from "@/lib/activeStatus";
import { parseActiveWorkerFilters, fetchActiveWorkerGroups, fetchActiveWorkerRows } from "@/lib/activeWorkers";

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
// User-wise Active Workers = contacts ASSIGNED to a caller and still active,
// grouped by the caller. A single backend GROUP BY, so the counts reflect the
// COMPLETE authorized dataset (never a paginated subset) and honour the caller's
// role/territory scope and Page Access exactly like the Contacts list.
//   Filters: search (worker name / mobile / caller), district_id, assembly_id,
//   block_id, designation_id, status (caller), worker_status (card).
//   &list=1&user_id=N → that caller's COMPLETE worker list (same filters, no cap).
// The query lives in lib/activeWorkers, shared with the PDF export.
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isSupervisor(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureActiveStatusColumn();
    const { searchParams } = new URL(req.url);
    const f = parseActiveWorkerFilters(searchParams);
    if (searchParams.get("list") === "1") {
      const userId = parseInt(searchParams.get("user_id"), 10);
      if (!Number.isInteger(userId) || userId <= 0) return NextResponse.json({ message: "A valid user is required." }, { status: 400 });
      const contacts = await fetchActiveWorkerRows(session, f, { userId });
      return NextResponse.json({ contacts, total: contacts.length }, { headers: { "Cache-Control": "no-store" } });
    }
    const data = await fetchActiveWorkerGroups(session, f);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
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
