import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { resolveActingUserId } from "@/lib/actAs";
import { query } from "@/lib/db";
import { ensureContactActiveStatusColumns } from "@/lib/contactExtras";
import { normalizeActiveStatus, ACTIVE_STATUS_LABEL } from "@/lib/activeStatus";
import { logAudit } from "@/lib/audit";

// Worker Status of ONE contact (the Active / Very Active / Average / Not Active a
// caller gives the worker they are calling). Lives on contacts.active_status —
// exactly one value per worker, written by UPDATE, so many callers updating the
// same worker can never create duplicate records. The Active Workers page reads
// this same stored value (never a hardcoded one).
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// Who may read/set a worker's status: anyone who can manage contacts (page access
// + admin/supervisor), or the caller the contact is assigned to / locked by — the
// same rule the contact-by-id endpoint applies.
async function canTouch(session, id) {
  const canManage = await pageAllowed(session, "contacts", isAdmin(session) || isOversight(session));
  if (canManage) return true;
  const { userId } = await resolveActingUserId(session);
  const [row] = await query("SELECT locked_by_user_id, assigned_to_user_id FROM contacts WHERE id = ?", [id]);
  return !!row && (String(row.locked_by_user_id) === String(userId) || String(row.assigned_to_user_id) === String(userId));
}

async function readStatus(id) {
  const [row] = await query(
    `SELECT c.active_status, c.active_status_updated_at,
            (SELECT username FROM users u WHERE u.id = c.active_status_updated_by) AS active_status_updated_by_name
       FROM contacts c WHERE c.id = ?`,
    [id]
  );
  if (!row) return null;
  const code = normalizeActiveStatus(row.active_status);
  return {
    active_status: code,                                   // canonical code or null (= not set yet)
    active_status_label: code ? ACTIVE_STATUS_LABEL[code] : null,
    updated_by: row.active_status_updated_by_name || null,
    updated_at: row.active_status_updated_at || null,
  };
}

export async function GET(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const { id } = await params;
    if (!(await canTouch(session, id))) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!(await ensureContactActiveStatusColumns())) return NextResponse.json({ active_status: null }, { headers: NO_STORE });
    const s = await readStatus(id);
    if (!s) return NextResponse.json({ message: "Contact not found." }, { status: 404, headers: NO_STORE });
    return NextResponse.json(s, { headers: NO_STORE });
  } catch (err) {
    console.error("[contact active-status] GET:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// POST { active_status: "VERY_ACTIVE" | "ACTIVE" | "AVERAGE" | "NOT_ACTIVE" }
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const { id } = await params;
    if (!(await canTouch(session, id))) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!(await ensureContactActiveStatusColumns())) {
      return NextResponse.json({ message: "Worker status is not available on this database." }, { status: 500, headers: NO_STORE });
    }
    const body = await req.json().catch(() => ({}));
    const value = normalizeActiveStatus(body?.active_status);
    if (!value) return NextResponse.json({ message: "Invalid worker status." }, { status: 400, headers: NO_STORE });
    const { userId } = await resolveActingUserId(session);
    // One row per worker: UPDATE in place. Nothing else on the contact changes.
    const res = await query(
      `UPDATE contacts SET active_status = ?, active_status_updated_by = ?, active_status_updated_at = NOW() WHERE id = ?`,
      [value, userId, id]
    );
    if (!res?.affectedRows) return NextResponse.json({ message: "Contact not found." }, { status: 404, headers: NO_STORE });
    logAudit(session, { action: "contact.worker_status", entityType: "contact", entityId: Number(id), details: { active_status: value } });
    const s = await readStatus(id);
    return NextResponse.json({ ok: true, id: Number(id), ...s }, { headers: NO_STORE });
  } catch (err) {
    console.error("[contact active-status] POST:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
