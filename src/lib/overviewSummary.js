import { query } from "@/lib/db";
import { callsUnion, CALL_TYPE_SPLIT } from "@/lib/allCalls";

// Shared builder for the Supervisor / State overview dashboards. Every metric is
// calculated live from ALL calls — Regular + Unfiltered (lib/allCalls), each
// call record once — for the SELECTED report date/range,
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

  let callWhere = "";
  const callParams = [];
  if (from) { callWhere += ` AND ${dateExpr} >= ?`; callParams.push(from); }
  if (to)   { callWhere += ` AND ${dateExpr} <= ?`; callParams.push(to); }
  callWhere += scopeWhere;
  callParams.push(...scopeParams);
  // The date range + scope are applied inside the combined calls source; every
  // query below reads `${src} c` with no further WHERE of its own.
  const { sql: src, params } = await callsUnion({ where: callWhere, params: callParams });
  const where = "WHERE 1=1";

  const n = (v) => Number(v) || 0;

  // Status groups of the Call Status card. Each is a condition on one call row of the unified source (alias c, statuses cs):
  //   Follow-up      a call that scheduled a follow-up: a regular call's follow_up_date, or an unfiltered call's own follow-up date
  //                  (uc_follow_up_date) - counted per call record, exactly like the regular calls were.
  //   Wrong Number   status "Wrong Number", or an unfiltered Phone Picked saved as "Not Active -> Wrong Number" (sentiment wrong_number).
  //   Active         status "Busy" + a Phone Picked saved as Active (sentiment active - Member / Unfiltered workflows).
  //   Not Active     status "Rudely Behaved" + a Phone Picked saved as Not Active (opponent / not interested / plain not_active).
  // The stored statuses and options are unchanged - only these card groups read them. The groups cannot overlap (different statuses, or
  // different sentiments of Phone Picked), so no call is counted twice across the cards or the breakdown.
  const SENT = "COALESCE(c.sentiment, c.uc_sentiment)";
  const PICKED = "cs.name = 'Phone Picked'";
  const FOLLOW_UP = "(c.follow_up_date IS NOT NULL OR c.uc_follow_up_date IS NOT NULL)";
  // COALESCE(..., 0): a call with no status / no sentiment must evaluate to FALSE, never NULL (NOT (NULL) would drop it from the
  // exclusive Connected slice).
  const WRONG = `COALESCE(cs.name = 'Wrong Number' OR (c.call_type = 'unfiltered' AND ${PICKED} AND c.uc_sentiment = 'wrong_number'), 0)`;
  const ACTIVE = `COALESCE(cs.name = 'Busy' OR (${PICKED} AND ${SENT} = 'active'), 0)`;
  const NOT_ACTIVE = `COALESCE(cs.name = 'Rudely Behaved' OR (${PICKED} AND ${SENT} IN ('not_active','opponent','member_opponent','not_interested')), 0)`;

  // ---- KPI tally (8 cards) — one grouped pass over the selected range ----
  const [agg] = await query(
    `SELECT
       COUNT(*)                            AS total,
       ${CALL_TYPE_SPLIT},
       SUM(cs.name = 'Phone Picked')       AS connected,
       SUM(cs.name = 'Not Picked')         AS no_answer,
       SUM(cs.name = 'Switched Off')       AS switched_off,
       SUM(cs.name = 'Busy')               AS busy,
       SUM(cs.name = 'Wrong Number')       AS wrong_number,
       SUM(cs.name = 'Rudely Behaved')     AS rejected,
       SUM(c.follow_up_date IS NOT NULL)   AS follow_up,
       -- State Overview's grouped Call Status card (see the group definitions above); the plain fields above are unchanged
       SUM(${WRONG})                       AS wrong_number_all,
       SUM(${ACTIVE})                      AS active,
       SUM(${NOT_ACTIVE})                  AS not_active,
       SUM(${FOLLOW_UP})                   AS follow_up_all,
       -- exclusive groups for the Status Breakdown chart (each call in exactly one slice)
       SUM(COALESCE(${PICKED}, 0) AND NOT ${ACTIVE} AND NOT ${NOT_ACTIVE} AND NOT ${WRONG}) AS b_connected
     FROM ${src} c
     LEFT JOIN call_statuses cs ON cs.id = c.status_id
     ${where}`,
    params
  );
  const tally = {
    total: n(agg?.total),
    regular_calls: n(agg?.regular_calls),
    unfiltered_calls: n(agg?.unfiltered_calls),
    connected: n(agg?.connected),
    no_answer: n(agg?.no_answer),
    switched_off: n(agg?.switched_off),
    busy: n(agg?.busy),
    wrong_number: n(agg?.wrong_number),
    rejected: n(agg?.rejected),
    follow_up: n(agg?.follow_up),
    wrong_number_all: n(agg?.wrong_number_all),
    active: n(agg?.active),
    not_active: n(agg?.not_active),
    follow_up_all: n(agg?.follow_up_all),
  };
  // "other" = statuses not covered above (kept for the Supervisor Overview's Status Breakdown pie, unchanged).
  tally.other = Math.max(
    0,
    tally.total - (tally.connected + tally.no_answer + tally.switched_off + tally.busy + tally.wrong_number + tally.rejected)
  );
  // State Overview's Status Breakdown: mutually exclusive slices (each call in exactly one), "other" = whatever none covers.
  const breakdown = {
    connected: n(agg?.b_connected), active: tally.active, not_active: tally.not_active,
    no_answer: tally.no_answer, switched_off: tally.switched_off, wrong_number: tally.wrong_number_all,
  };
  breakdown.other = Math.max(0, tally.total - Object.values(breakdown).reduce((a, b) => a + b, 0));

  // ---- Calls over time (grouped by IST date across the range) ----
  const timelineRows = await query(
    `SELECT ${dateExpr} AS date, COUNT(*) AS count
       FROM ${src} c ${where}
      GROUP BY date ORDER BY date`,
    params
  );
  const timeline = timelineRows.map((r) => ({ date: String(r.date), count: n(r.count) }));

  // ---- Hourly productivity (IST hour, capped at the current hour when the
  //      range reaches today; a purely historical range shows all 24) ----
  const hourRows = await query(
    `SELECT HOUR(CONVERT_TZ(c.called_at,'+00:00','${IST}')) AS h, COUNT(*) AS n
       FROM ${src} c ${where} GROUP BY h`,
    params
  );
  const includesToday = !to || String(to) >= today;
  const maxHour = includesToday ? Number(nowIST?.cur_hour ?? 23) : 23;
  const hourCounts = {};
  hourRows.forEach((r) => { hourCounts[Number(r.h)] = n(r.n); });
  const hourly = [];
  for (let h = 0; h <= maxHour; h++) hourly.push({ hour: h, calls: hourCounts[h] || 0 });

  // ---- Top callers by TOTAL CALLS = Regular (RC) + Unfiltered (UC) (actual caller roles only) - EVERY caller with calls in the range ----
  // `src` already holds every call attempt of BOTH kinds exactly once (calls rows + unfiltered_call_logs rows, attributed to the
  // calling user), so COUNT(*) is RC + UC and the SUMs split it. Ranked by that combined total (highest first), ties broken by
  // connected ("Phone Picked") calls. connected_pct = connected / total attempts x 100 is still shown. Follow-ups are split the same
  // way: RC = the regular call's follow_up_date, UC = the unfiltered call's own follow-up date, attributed to the calling user
  // (caller_id / user_id of the record, never the viewer). Photo / designation come from the caller's linked worker through
  // subqueries (one value per caller), so a user with several worker rows can never multiply the call counts.
  const topRows = await query(
    `SELECT u.id, u.username AS name,
            (SELECT w.photo_url FROM workers w WHERE w.user_id = u.id ORDER BY w.id LIMIT 1) AS photo_url,
            (SELECT w.position FROM workers w WHERE w.user_id = u.id ORDER BY w.id LIMIT 1) AS designation,
            COUNT(*) AS total,
            ${CALL_TYPE_SPLIT},
            SUM(cs.name = 'Phone Picked') AS connected,
            SUM(c.call_type = 'regular' AND c.follow_up_date IS NOT NULL) AS rc_follow_ups,
            SUM(c.uc_follow_up_date IS NOT NULL) AS uc_follow_ups
       FROM ${src} c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN call_statuses cs ON cs.id = c.status_id
      ${where} AND u.role IN ('caller','user','agent')
      GROUP BY u.id, u.username
      -- Rank by COMBINED calls (Regular + Unfiltered), highest first; ties by connected calls, then id (stable).
      ORDER BY COUNT(*) DESC, SUM(cs.name = 'Phone Picked') DESC, u.id ASC`,
    params
  );
  const top_callers = topRows.map((r) => {
    const total = n(r.total), connected = n(r.connected);
    return {
      id: r.id, name: r.name, photo_url: r.photo_url || null, designation: r.designation || null,
      total, regular_calls: n(r.regular_calls), unfiltered_calls: n(r.unfiltered_calls), connected,
      rc_follow_ups: n(r.rc_follow_ups), uc_follow_ups: n(r.uc_follow_ups), follow_ups: n(r.rc_follow_ups) + n(r.uc_follow_ups),
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
                SUM(${istDay} = ?) AS today,
                MAX(created_at) AS last_activity,
                (SELECT COALESCE(SUM(followers),0) FROM social_pages WHERE is_active=1 AND platform='instagram') AS ig_followers,
                (SELECT COALESCE(SUM(followers),0) FROM social_pages WHERE is_active=1 AND platform='facebook')  AS fb_followers
           FROM social_posts`,
        [today]
      );
      social = {
        total: n(s?.total), scheduled: n(s?.scheduled), published: n(s?.published),
        today: n(s?.today), last_activity: s?.last_activity || null,
        ig_followers: n(s?.ig_followers), fb_followers: n(s?.fb_followers),
      };
    } catch { social = null; }
  }

  return {
    tally,
    breakdown,
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
