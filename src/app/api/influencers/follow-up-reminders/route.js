import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { ensureInfluencerSchema, getInfluencerColumns } from "@/lib/influencerSchema";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";
import { enrichJoinedBy } from "@/lib/influencerIO";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { todayInAppTz, reminderTargetDate } from "@/lib/followUpReminder";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET /api/influencers/follow-up-reminders
// "Tomorrow Follow-up" reminders for the signed-in Supervisor-2: influencers
// assigned to THEM whose Follow-up Date is tomorrow (application timezone). The
// assignee is always the session user — never a client parameter — so one
// supervisor can never read another's list. Computed live from the records, so a
// changed date / reassignment is reflected immediately and nothing is duplicated.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (normalizeRole(session.user?.role) !== ROLES.SUPERVISOR) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    if (!(await userCanAccessPageKey(session, "influencers"))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    await ensureInfluencerSchema();
    const cols = await getInfluencerColumns();
    const today = todayInAppTz();
    const date = reminderTargetDate();
    if (!cols.has("assigned_supervisor_id")) return NextResponse.json({ today, date, reminders: [] }, { headers: NO_STORE });
    await ensureContactDesignationsSchema().catch(() => {});
    const rows = await query(
      `SELECT * FROM influencers WHERE assigned_supervisor_id = ? AND follow_up_date = ? ORDER BY name ASC, id ASC`,
      [session.user.id, date]
    );
    await enrichJoinedBy(rows);
    const reminders = rows.map((r) => ({
      id: r.id, name: r.name, phone: r.phone, photo_url: r.photo_url,
      assembly_name: r.assembly_name, current_party: r.current_party, status: r.status,
      influencer_rating: r.influencer_rating, remark: r.remark,
      follow_up_date: String(r.follow_up_date).slice(0, 10),
      joined_by_name: r.joined_by_name || null, joined_by_designation: r.joined_by_designation || null,
      joined_by_phone: r.joined_by_mobile || r.joined_by_phone || null,
      label: "Tomorrow Follow-up", label_hi: "कल Follow-up करना है",
    }));
    return NextResponse.json({ today, date, reminders }, { headers: NO_STORE });
  } catch (err) {
    console.error("[influencer] follow-up reminders:", err?.sqlMessage || err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
