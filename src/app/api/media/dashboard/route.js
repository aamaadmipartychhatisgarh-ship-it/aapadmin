import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessMedia } from "@/lib/permissions";
import { query } from "@/lib/db";
import { resolveRange } from "@/lib/reports/timeRanges";

// GET /api/media/dashboard — the Media Dashboard's KPI numbers (Yesterday/
// Weekly/Monthly + trend for each card). Deliberately NOT built on top of
// /api/reports: that route gates to oversight roles only before a module's
// own `access` is even consulted, which would 403 for press_media — who
// canAccessMedia (same gate the rest of the Media Center uses) explicitly
// allows. The "click to open detailed report" links on each card still
// point at the Reports Center (oversight-only, same as every other report),
// so that deeper drill-down naturally stays oversight-scoped; only the
// dashboard's own headline numbers need to work for press_media too.
export const dynamic = "force-dynamic";

function shiftDate(ymd, days) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canAccessMedia(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const yesterday = resolveRange("yesterday");
    const dayBefore = { from: shiftDate(yesterday.from, -1), to: shiftDate(yesterday.from, -1) };
    const thisWeek = resolveRange("this_week");
    const lastWeek = resolveRange("last_week");
    const thisMonth = resolveRange("this_month");
    const lastMonth = resolveRange("last_month");
    const today = resolveRange("today").from;
    const weekEnd = shiftDate(thisWeek.from, 6);
    const monthEnd = new Date(Date.UTC(new Date(today + "T00:00:00Z").getUTCFullYear(), new Date(today + "T00:00:00Z").getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

    // Six windows in one query per metric, via conditional aggregation —
    // one round trip per card instead of six.
    const periods = [yesterday.from, dayBefore.from, thisWeek.from, thisWeek.to, lastWeek.from, lastWeek.to, thisMonth.from, thisMonth.to, lastMonth.from, lastMonth.to];

    async function countBy(dateExpr, extraWhere, extraParams = []) {
      const [row] = await query(
        `SELECT
            SUM(CASE WHEN ${dateExpr} = ? THEN 1 ELSE 0 END) AS yesterday,
            SUM(CASE WHEN ${dateExpr} = ? THEN 1 ELSE 0 END) AS day_before,
            SUM(CASE WHEN ${dateExpr} BETWEEN ? AND ? THEN 1 ELSE 0 END) AS this_week,
            SUM(CASE WHEN ${dateExpr} BETWEEN ? AND ? THEN 1 ELSE 0 END) AS last_week,
            SUM(CASE WHEN ${dateExpr} BETWEEN ? AND ? THEN 1 ELSE 0 END) AS this_month,
            SUM(CASE WHEN ${dateExpr} BETWEEN ? AND ? THEN 1 ELSE 0 END) AS last_month
           FROM press_notes pn ${extraWhere ? `WHERE ${extraWhere}` : ""}`,
        [...periods, ...extraParams]
      );
      return {
        yesterday: Number(row.yesterday || 0), day_before: Number(row.day_before || 0),
        this_week: Number(row.this_week || 0), last_week: Number(row.last_week || 0),
        this_month: Number(row.this_month || 0), last_month: Number(row.last_month || 0),
      };
    }

    const newspapersPublished = await countBy("pn.coverage_date", "pn.kind = ?", ["newspaper_scan"]);
    const mediaCoverageTotal = await countBy("pn.coverage_date", null);
    const pressNotesReleased = await countBy("pn.coverage_date", "pn.kind = ?", ["press_note"]);

    const [debatesRow] = await query(
      `SELECT
          SUM(CASE WHEN de.debate_date = ? THEN 1 ELSE 0 END) AS yesterday,
          SUM(CASE WHEN de.debate_date = ? THEN 1 ELSE 0 END) AS day_before,
          SUM(CASE WHEN de.debate_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS this_week,
          SUM(CASE WHEN de.debate_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS last_week,
          SUM(CASE WHEN de.debate_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS this_month,
          SUM(CASE WHEN de.debate_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS last_month
         FROM debates de WHERE de.status <> 'cancelled'`,
      periods
    );
    const tvDebates = {
      yesterday: Number(debatesRow.yesterday || 0), day_before: Number(debatesRow.day_before || 0),
      this_week: Number(debatesRow.this_week || 0), last_week: Number(debatesRow.last_week || 0),
      this_month: Number(debatesRow.this_month || 0), last_month: Number(debatesRow.last_month || 0),
    };

    const [confRow] = await query(
      `SELECT
          SUM(CASE WHEN DATE(pc.conference_date) = ? THEN 1 ELSE 0 END) AS yesterday,
          SUM(CASE WHEN DATE(pc.conference_date) = ? THEN 1 ELSE 0 END) AS day_before,
          SUM(CASE WHEN DATE(pc.conference_date) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS this_week,
          SUM(CASE WHEN DATE(pc.conference_date) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS last_week,
          SUM(CASE WHEN DATE(pc.conference_date) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS this_month,
          SUM(CASE WHEN DATE(pc.conference_date) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS last_month
         FROM press_conferences pc WHERE pc.status <> 'cancelled'`,
      periods
    );
    const pressConferences = {
      yesterday: Number(confRow.yesterday || 0), day_before: Number(confRow.day_before || 0),
      this_week: Number(confRow.this_week || 0), last_week: Number(confRow.last_week || 0),
      this_month: Number(confRow.this_month || 0), last_month: Number(confRow.last_month || 0),
    };

    // Pending Media Activities — forward-looking (scheduled, due today/this
    // week/this month), not a historical trend.
    const [[pendingDebates], [pendingConfs]] = await Promise.all([
      query(
        `SELECT
            SUM(CASE WHEN de.debate_date = ? THEN 1 ELSE 0 END) AS due_today,
            SUM(CASE WHEN de.debate_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS due_week,
            SUM(CASE WHEN de.debate_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS due_month
           FROM debates de WHERE de.status = 'scheduled'`,
        [today, today, weekEnd, today, monthEnd]
      ),
      query(
        `SELECT
            SUM(CASE WHEN DATE(pc.conference_date) = ? THEN 1 ELSE 0 END) AS due_today,
            SUM(CASE WHEN DATE(pc.conference_date) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS due_week,
            SUM(CASE WHEN DATE(pc.conference_date) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS due_month
           FROM press_conferences pc WHERE pc.status = 'scheduled'`,
        [today, today, weekEnd, today, monthEnd]
      ),
    ]);
    const pendingActivities = {
      due_today: Number(pendingDebates.due_today || 0) + Number(pendingConfs.due_today || 0),
      due_week: Number(pendingDebates.due_week || 0) + Number(pendingConfs.due_week || 0),
      due_month: Number(pendingDebates.due_month || 0) + Number(pendingConfs.due_month || 0),
    };

    return NextResponse.json({
      newspapersPublished, pressConferences, tvDebates, mediaCoverageTotal, pressNotesReleased, pendingActivities,
    });
  } catch (err) {
    console.error("media dashboard error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
