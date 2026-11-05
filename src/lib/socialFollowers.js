import { query } from "@/lib/db";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { ensureSocialPageSchema } from "@/lib/socialPageSchema";
import { todayIST } from "@/lib/socialDates";

// FOLLOWERS HISTORY. social_pages.followers is ONE current number the team keeps up to date by hand; it never carried history. Each time
// it is set (page created, followers edited) - and, as a safety net, whenever a read finds the current number differs from the last
// recorded one - the value is stored as a dated snapshot (one per page per day, the last value of that day wins). A date's follower
// count is then the NEAREST SNAPSHOT ON OR BEFORE that date (the number stays what it was until the next update). Nothing is estimated:
// a date earlier than a page's first snapshot has NO count, and is reported as unavailable - never as zero.
export async function recordFollowerSnapshot(pageId, followers, source = "update", userId = null) {
  await ensureSocialPageSchema();
  await query(
    `INSERT INTO social_page_follower_snapshots (page_id, snapshot_date, followers, source, recorded_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE followers = VALUES(followers), source = VALUES(source), recorded_by = VALUES(recorded_by)`,
    [pageId, todayIST(), Math.max(0, Math.floor(Number(followers) || 0)), source, userId]
  );
}

// The same Lok Sabha scope as the Pages list (zone / district / assembly admins see their own area's pages).
export function socialPageScope(session, alias = "sp") {
  const role = normalizeRole(session.user.role), u = session.user;
  if (role === ROLES.ZONE_ADMIN && u.scope_zone_id) return { where: `AND ${alias}.lok_sabha_id IN (SELECT id FROM locations WHERE type='lok_sabha' AND parent_id = ?)`, params: [u.scope_zone_id] };
  if (role === ROLES.DISTRICT_ADMIN && u.home_district_id) return { where: `AND ${alias}.lok_sabha_id = (SELECT parent_id FROM locations WHERE id = ?)`, params: [u.home_district_id] };
  if (role === ROLES.ASSEMBLY_ADMIN && u.scope_assembly_id) return { where: `AND ${alias}.lok_sabha_id = (SELECT ld.parent_id FROM locations ld WHERE ld.id = (SELECT parent_id FROM locations WHERE id = ?))`, params: [u.scope_assembly_id] };
  return { where: "", params: [] };
}

export const PLATFORM_LABEL = { facebook: "Facebook", instagram: "Instagram", twitter: "Twitter / X" };

// Growth of every page in scope between two dates (both inclusive, start <= end, end <= today - validated by the caller).
export async function followersGrowth(session, { start, end, platform = null, userId = null }) {
  await ensureSocialPageSchema();
  const sc = socialPageScope(session);
  const w = ["1 = 1"], params = [];
  if (platform) { w.push("sp.platform = ?"); params.push(platform); }
  const pages = await query(
    `SELECT sp.id, sp.platform, sp.handle, sp.lok_sabha_name, sp.followers FROM social_pages sp WHERE ${w.join(" AND ")} ${sc.where} ORDER BY sp.platform, sp.handle, sp.id`,
    [...params, ...sc.params]
  );
  // Safety net: a page whose current number is not the last recorded one gets today's snapshot of the current number.
  if (pages.length) {
    const ph = pages.map(() => "?").join(",");
    const last = await query(
      `SELECT s.page_id, s.followers FROM social_page_follower_snapshots s
        WHERE s.page_id IN (${ph}) AND s.snapshot_date = (SELECT MAX(x.snapshot_date) FROM social_page_follower_snapshots x WHERE x.page_id = s.page_id)`,
      pages.map((p) => p.id)
    );
    const lastBy = new Map(last.map((r) => [r.page_id, r.followers]));
    for (const p of pages) {
      if (!lastBy.has(p.id) || Number(lastBy.get(p.id)) !== Number(p.followers ?? 0)) await recordFollowerSnapshot(p.id, p.followers ?? 0, lastBy.has(p.id) ? "sync" : "initial", userId);
    }
  }
  const at = async (pageId, date) => {
    const [r] = await query(
      `SELECT followers, DATE_FORMAT(snapshot_date, '%Y-%m-%d') AS d FROM social_page_follower_snapshots WHERE page_id = ? AND snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1`,
      [pageId, date]
    );
    return r ? { followers: Number(r.followers), as_of: r.d } : null;
  };
  const rows = [];
  for (const p of pages) {
    const s = await at(p.id, start), e = await at(p.id, end);
    const [first] = await query(`SELECT DATE_FORMAT(MIN(snapshot_date), '%Y-%m-%d') AS d FROM social_page_follower_snapshots WHERE page_id = ?`, [p.id]);
    const ok = !!(s && e);
    rows.push({
      id: p.id, platform: p.platform, platform_label: PLATFORM_LABEL[p.platform] || p.platform, handle: p.handle, lok_sabha_name: p.lok_sabha_name || null,
      start_followers: s ? s.followers : null, start_as_of: s ? s.as_of : null,
      end_followers: e ? e.followers : null, end_as_of: e ? e.as_of : null,
      growth: ok ? e.followers - s.followers : null,
      status: ok ? "ok" : "unavailable",
      note: ok ? null : `No follower record on or before ${!s ? start : end}${first?.d ? ` (first record: ${first.d.slice(8, 10)}/${first.d.slice(5, 7)}/${first.d.slice(0, 4)})` : ""}`,
    });
  }
  const good = rows.filter((r) => r.status === "ok");
  const totals = {
    pages: rows.length, compared: good.length, unavailable: rows.length - good.length,
    start_followers: good.reduce((a, r) => a + r.start_followers, 0), end_followers: good.reduce((a, r) => a + r.end_followers, 0),
    growth: good.reduce((a, r) => a + r.growth, 0),
  };
  return { start, end, platform, rows, totals };
}
