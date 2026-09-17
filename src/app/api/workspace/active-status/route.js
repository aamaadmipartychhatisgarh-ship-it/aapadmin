import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { resolveActingUserId } from "@/lib/actAs";
import { normalizeActiveStatus } from "@/lib/activeStatus";

// The caller's self-reported working Active Status, shown/managed in My
// Workspace. Persisted on the user row (users.active_status), never only in the
// browser. A caller updates ONLY their own; a Super Admin operating a caller's
// dashboard (preview) updates THAT caller — the same acting-user model call
// logging uses — so nobody edits another caller's status by accident.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

let ensured = false;
async function ensureColumn() {
  if (ensured) return;
  try {
    const rows = await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'active_status'`
    );
    if (Number(rows[0]?.n || 0) === 0) {
      await query(`ALTER TABLE users ADD COLUMN active_status VARCHAR(20) NULL`);
    }
    ensured = true;
  } catch (e) {
    console.error("[active-status] ensureColumn:", e?.message || e);
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
  await ensureColumn();
  const { userId } = await resolveActingUserId(session);
  const [row] = await query(`SELECT active_status FROM users WHERE id = ?`, [userId]);
  return NextResponse.json({ active_status: row?.active_status || null }, { headers: NO_STORE });
}

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
  await ensureColumn();
  const body = await req.json().catch(() => ({}));
  // Server-side validation — reject anything outside the four allowed values.
  const value = normalizeActiveStatus(body?.active_status);
  if (!value) {
    return NextResponse.json({ message: "Invalid active status." }, { status: 400, headers: NO_STORE });
  }
  // Save against the acting user only (self, or the previewed caller).
  const { userId } = await resolveActingUserId(session);
  await query(`UPDATE users SET active_status = ? WHERE id = ?`, [value, userId]);
  const [row] = await query(`SELECT active_status FROM users WHERE id = ?`, [userId]);
  return NextResponse.json({ ok: true, active_status: row?.active_status || value }, { headers: NO_STORE });
}
