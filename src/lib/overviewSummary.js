import { query } from "@/lib/db";

// Shared builder for the Supervisor / State overview dashboards. Every metric is
// calculated live from the calls table for the SELECTED report date/range,
// defaulting to TODAY. All date/time math is in the application timezone
// (Asia/Kolkata, a fixed +05:30 with no DST); called_at is a UTC TIMESTAMP so we
// CONVERT_TZ it consistently. Nothing is cached or a lifetime total.
//
// Pass an optional scope fragment ({ where, params } from scopeFilterSync on the
// alias "c") to restrict to an admin's territory — the Supervisor view passes
// nothing (state-wide); the State view passes the admin's scope. The returned
// shape is identical either way, so both dashboards render from one component.
const IST = "+05:30";

export async function buildOverviewSummary({ date_from, date_to, scope, includeTeams = false } = {}) {
  const dateExpr = `DATE(CONVERT_TZ(c.called_at,'+00:00','${IST}'))`;
  const [nowIST] = await query(
    `SELECT DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','${IST}')) AS today,
            HOUR(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','${IST}')) AS cur_hour`
  );
  const today = String(nowIST?.today ?? "");

  // Effective range (inclusive). No selection → today only.
  const from = date_from || (date_to ? null : today);
  const to = date_to || (date_from ? null : today);

  const scopeWhere = scope?.where ? ` ${scope.where}` : "";
  const scopeParams = scope?.params ?? [];

  let where = "WHERE 1=1";
  const params = [];
  if (from) { where += ` AND ${dateExpr} >= ?`; params.push(from); }
  if (to)   { where += ` AND ${dateExpr} <= ?`; params.push(to); }
  where += scopeWhere;
  params.push(...scopeParams);

  const n = (v) => Number(v) || 0;

  // ---- KPI tally (8 cards) — one grouped pass over the selected range ----
  const [agg] = await query(
    `SELECT
       COUNT(*)                            AS total,
       SUM(cs.name = 'Phone Picked')       AS connected,
       SUM(cs.name = 'Not Picked')         AS no_answer,
       SUM(cs.name = 'Switched Off')       AS switched_off,
       SUM(cs.name = 'Busy')               AS busy,
       SUM(cs.name = 'Wrong Number')       AS wrong_number,
       SUM(cs.name = 'Rudely Behaved')     AS rejected,
       SUM(c.follow_up_date IS NOT NULL)   AS follow_up
     FROM calls c
     LEFT JOIN call_statuses cs ON cs.id = c.status_id
     ${where}`,
    params
  );
  const tally = {
    total: n(agg?.total),
    connected: n(agg?.connected),
    no_answer: n(agg?.no_answer),
    switched_off: n(agg?.switched_off),
    busy: n(agg?.busy),
    wrong_number: n(agg?.wrong_number),
    rejected: n(agg?.rejected),
    follow_up: n(agg?.follow_up),
  };
  // "other" = statuses not covered above (kept for the Status Breakdown pie).
  tally.other = Math.max(
    0,
    tally.total - (tally.connected + tally.no_answer + tally.switched_off + tally.busy + tally.wrong_number + tally.rejected)
  );

  // ---- Calls over time (grouped by IST date across the range) ----
  const timelineRows = await query(
    `SELECT ${dateExpr} AS date, COUNT(*) AS count
       FROM calls c ${where}
      GROUP BY date ORDER BY date`,
    params
  );
  const timeline = timelineRows.map((r) => ({ date: String(r.date), count: n(r.count) }));

  // ---- Hourly productivity (IST hour, capped at the current hour when the
  //      range reaches today; a purely historical range shows all 24) ----
  const hourRows = await query(
    `SELECT HOUR(CONVERT_TZ(c.called_at,'+00:00','${IST}')) AS h, COUNT(*) AS n
       FROM calls c ${where} GROUP BY h`,
    params
  );
  const includesToday = !to || String(to) >= today;
  const maxHour = includesToday ? Number(nowIST?.cur_hour ?? 23) : 23;
  const hourCounts = {};
  hourRows.forEach((r) => { hourCounts[Number(r.h)] = n(r.n); });
  const hourly = [];
  for (let h = 0; h <= maxHour; h++) hourly.push({ hour: h, calls: hourCounts[h] || 0 });

  // ---- Top 5 callers by CONNECTED-CALL % (actual caller roles only) ----
  // connected_pct = connected ("Phone Picked") ÷ total call attempts × 100. The
  // Top 5 are ranked by that percentage (highest first), tie-broken by call
  // volume so a higher-volume caller leads at an equal rate. Every returned row
  // has ≥1 call (they come from `calls`), so the SQL ratio never divides by
  // zero; the JS still guards total===0 → 0% for safety. Photo/designation come
  // from the caller's linked worker when available.
  const topRows = await query(
    `SELECT u.id, u.username AS name, w.photo_url AS photo_url, w.position AS designation,
            COUNT(*) AS total,
            SUM(cs.name = 'Phone Picked') AS connected,
            SUM(c.follow_up_date IS NOT NULL) AS follow_ups
       FROM calls c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
       LEFT JOIN workers w ON w.user_id = u.id
      ${where} AND u.role IN ('caller','user','agent')
      GROUP BY u.id
      -- Rank STRICTLY by number of connected ('Phone Picked') calls, highest
      -- first; ties broken by total call volume. (Not by percentage/total.)
      ORDER BY SUM(cs.name = 'Phone Picked') DESC, COUNT(*) DESC LIMIT 5`,
    params
  );
  const top_callers = topRows.map((r) => {
    const total = n(r.total), connected = n(r.connected);
    return {
      id: r.id, name: r.name, photo_url: r.photo_url || null, designation: r.designation || null,
      total, connected, follow_ups: n(r.follow_ups),
      // Connected-call percentage; 0 when there are no attempts (never NaN/Infinity).
      connected_pct: total ? Math.round((connected / total) * 100) : 0,
    };
  });

  // Optional team snapshots (Super Admin dashboard). Org-wide status, not
  // date-filtered. Best-effort so a missing table never breaks the dashboard.
  let media = null, social = null;
  if (includeTeams) {
    const istDay = `DATE(CONVERT_TZ(created_at,'+00:00','${IST}'))`;
    try {
      const [m] = await query(
        `SELECT
           (SELECT COUNT(*) FROM media_library) AS uploads,
           (SELECT COUNT(*) FROM press_notes) AS press_notes,
           (SELECT COUNT(*) FROM media_library WHERE ${istDay} = ?) +
           (SELECT COUNT(*) FROM press_notes  WHERE ${istDay} = ?) AS today,
           (SELECT MAX(created_at) FROM media_library) AS last_activity`,
        [today, today]
      );
      media = { uploads: n(m?.uploads), press_notes: n(m?.press_notes), total: n(m?.uploads) + n(m?.press_notes), today: n(m?.today), last_activity: m?.last_activity || null };
    } catch { media = null; }
    try {
      const [s] = await query(
        `SELECT COUNT(*) AS total,
                SUM(scheduled_at IS NOT NULL AND posted_at IS NULL) AS scheduled,
                SUM(posted_at IS NOT NULL) AS published,
                SUM(approval_status = 'pending') AS pending_approval,
                SUM(${istDay} = ?) AS today,
                MAX(created_at) AS last_activity
           FROM social_posts`,
        [today]
      );
      social = { total: n(s?.total), scheduled: n(s?.scheduled), published: n(s?.published), pending_approval: n(s?.pending_approval), today: n(s?.today), last_activity: s?.last_activity || null };
    } catch { social = null; }
  }

  return {
    tally,
    hourly,
    timeline,
    top_callers,
    media,
    social,
    range: { from, to },
    is_today: from === today && to === today,
    today,
  };
}
