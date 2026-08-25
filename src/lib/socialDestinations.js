import { query } from "@/lib/db";

// BUG 19 — shared logic for one post's platform/page destinations.
//
// Validation (§8): every destination's page must exist; its platform is taken
// authoritatively from the page's own record (so a client can never mismatch a
// page to the wrong platform). Duplicate pages are already removed upstream by
// normalizeDestinations (§9).

// Given normalized destinations [{page_id, platform, post_link}], resolve each
// page from social_pages and return { rows, error }. `rows` carry the true
// platform + page metadata. Returns an error string if any page is unknown.
export async function resolveDestinations(destinations) {
  if (!destinations.length) return { error: "Select at least one page." };
  const ids = destinations.map((d) => d.page_id);
  const pages = await query(
    `SELECT id, platform, handle, lok_sabha_name FROM social_pages WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  const byId = new Map(pages.map((p) => [Number(p.id), p]));
  const rows = [];
  for (const d of destinations) {
    const pg = byId.get(d.page_id);
    if (!pg) return { error: `A selected page no longer exists (id ${d.page_id}).` };
    rows.push({
      page_id: d.page_id,
      platform: pg.platform, // authoritative — page decides its platform
      handle: pg.handle,
      lok_sabha_name: pg.lok_sabha_name,
      post_link: d.post_link || null,
    });
  }
  return { rows };
}

// Replace a post's destinations with `rows` inside an open transaction conn.
// Diff-based so unrelated destinations are untouched (§10): pages no longer in
// the set are deleted, existing ones have their link/platform updated, new ones
// inserted. UNIQUE(post_id,page_id) guarantees no duplicate destination.
export async function syncPostDestinations(conn, postId, rows) {
  const [existing] = await conn.query(
    `SELECT page_id FROM social_post_destinations WHERE post_id = ?`,
    [postId]
  );
  const wanted = new Set(rows.map((r) => r.page_id));
  const have = new Set(existing.map((e) => Number(e.page_id)));

  const toDelete = [...have].filter((id) => !wanted.has(id));
  if (toDelete.length) {
    await conn.query(
      `DELETE FROM social_post_destinations WHERE post_id = ? AND page_id IN (${toDelete.map(() => "?").join(",")})`,
      [postId, ...toDelete]
    );
  }
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    await conn.query(
      `INSERT INTO social_post_destinations (post_id, platform, page_id, post_link)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE platform = VALUES(platform), post_link = VALUES(post_link), updated_at = CURRENT_TIMESTAMP`,
      [postId, r.platform, r.page_id, r.post_link]
    );
  }
}

// Load destinations for a set of post ids, grouped by post_id, each with live
// page metadata (name/platform) so the list/edit always reflect current pages.
export async function destinationsByPost(postIds) {
  const map = {};
  if (!postIds.length) return map;
  const rows = await query(
    `SELECT d.post_id, d.page_id, d.platform, d.post_link,
            sp.handle, sp.lok_sabha_name
       FROM social_post_destinations d
       LEFT JOIN social_pages sp ON sp.id = d.page_id
      WHERE d.post_id IN (${postIds.map(() => "?").join(",")})
      ORDER BY d.platform, sp.handle`,
    postIds
  );
  for (const r of rows) {
    (map[r.post_id] ||= []).push({
      page_id: r.page_id,
      platform: r.platform,
      page_name: r.handle,
      lok_sabha_name: r.lok_sabha_name,
      post_link: r.post_link,
    });
  }
  return map;
}
