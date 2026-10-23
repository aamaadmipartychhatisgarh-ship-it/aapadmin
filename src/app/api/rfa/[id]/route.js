import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { ensureRfaSchema } from "@/lib/rfa";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// PATCH /api/rfa/[id] { status: "Approved" | "Rejected", remark? } — Super Admin
// decides a Pending review. Approved keeps the Contact's active slot (no new
// submission); Rejected releases it so the Contact can be submitted again. The
// UPDATE only matches a still-Pending row, so a double decision changes nothing.
export async function PATCH(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!isSuperAdmin(session)) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    await ensureRfaSchema();
    const { id } = await params;
    const rid = parseInt(id, 10);
    const body = await req.json().catch(() => ({}));
    const status = body?.status;
    if (!Number.isInteger(rid) || rid <= 0 || !["Approved", "Rejected"].includes(status)) return NextResponse.json({ message: "Invalid request." }, { status: 400, headers: NO_STORE });
    const remark = String(body?.remark ?? "").trim().slice(0, 1000) || null;
    const res = await query(
      `UPDATE contact_rfa_reviews
          SET status = ?, active_contact_id = ${status === "Rejected" ? "NULL" : "active_contact_id"},
              reviewed_by_user_id = ?, reviewed_by_name = ?, reviewed_at = NOW(), review_remark = ?
        WHERE id = ? AND status = 'Pending'`,
      [status, session.user.id, String(session.user.name || session.user.username || "").slice(0, 150) || null, remark, rid]
    );
    if (!res.affectedRows) return NextResponse.json({ message: "This review is not pending (already decided or not found)." }, { status: 409, headers: NO_STORE });
    const [row] = await query("SELECT * FROM contact_rfa_reviews WHERE id = ?", [rid]);
    logAudit(session, { action: `rfa_${status.toLowerCase()}`, entityType: "contact", entityId: String(row.contact_id), details: `RfA review #${rid} ${status}` });
    return NextResponse.json({ review: row }, { headers: NO_STORE });
  } catch (err) {
    console.error("[rfa] decide:", err?.sqlMessage || err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
