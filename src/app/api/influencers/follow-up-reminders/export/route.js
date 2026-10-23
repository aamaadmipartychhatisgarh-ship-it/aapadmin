import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import * as XLSX from "xlsx";
import { authOptions } from "@/lib/auth";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { loadFollowUps, parseFollowUpFilters } from "@/lib/followUpFeed";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

const REMINDER = { today: "Today", tomorrow: "Tomorrow Follow-up", upcoming: "Upcoming" };
// Same columns, order and values as the dashboard section.
const COLUMNS = [
  ["Influencer Name", (r) => r.name],
  ["Phone Number", (r) => r.phone],
  ["Party Joined By – Name", (r) => r.joined_by_name],
  ["Joined By Designation", (r) => r.joined_by_designation],
  ["Joined By Phone", (r) => r.joined_by_phone],
  ["Remark", (r) => r.remark],
  ["Follow-up Date", (r) => r.follow_up_date],
  ["Reminder", (r) => REMINDER[r.when]],
  ["Assembly", (r) => r.assembly_name],
  ["Party", (r) => r.current_party],
  ["Status", (r) => r.status],
];

// GET /api/influencers/follow-up-reminders/export?range=&search=
// Excel of exactly the records the signed-in Supervisor-2's dashboard section shows
// for the same filters (every upcoming follow-up when none are set). The assignee is
// the session user — never a parameter.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (normalizeRole(session.user?.role) !== ROLES.SUPERVISOR) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    if (!(await userCanAccessPageKey(session, "influencers"))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    const feed = await loadFollowUps(session.user.id, parseFollowUpFilters(new URL(req.url).searchParams));
    const head = COLUMNS.map(([h]) => h);
    const body = feed.rows.map((r) => COLUMNS.map(([h, get]) => {
      const v = get(r);
      if (v === null || v === undefined) return "";
      // Real Excel date (shown dd mmm yyyy, sortable), built in UTC so it never shifts a day.
      if (h === "Follow-up Date") { const [y, m, d] = v.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
      return String(v); // phone numbers etc. stay text
    }));
    const ws = XLSX.utils.aoa_to_sheet([head, ...body], { cellDates: true });
    const di = head.indexOf("Follow-up Date");
    for (let i = 1; i <= body.length; i++) { const c = ws[XLSX.utils.encode_cell({ r: i, c: di })]; if (c) c.z = "dd mmm yyyy"; }
    ws["!cols"] = head.map((h) => ({ wch: h === "Remark" ? 40 : Math.max(14, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Influencer Follow-ups");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true });
    return new NextResponse(new Uint8Array(buf), {
      headers: { ...NO_STORE, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="Influencer_Followups_${feed.today}.xlsx"` },
    });
  } catch (err) {
    console.error("[influencer] follow-up export:", err?.sqlMessage || err?.message || err);
    return NextResponse.json({ message: "Could not generate the export." }, { status: 500, headers: NO_STORE });
  }
}
