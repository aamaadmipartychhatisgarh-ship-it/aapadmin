import { query } from "@/lib/db";

// Lazy, idempotent schema patch for social_posts + destinations.
//   • caption widened TEXT→LONGTEXT (unlimited long-form content).
//   • social_post_destinations: one row per (post → platform → page) with its
//     OWN post_link, so one post can target many platforms/pages, each with an
//     independent link (BUG 19). Existing single-page posts are backfilled into
//     this table once, so every read/count path can use it uniformly.
// Runs once per process; safe to call on every post write path.
let ensured = false;

export async function ensureSocialPostSchema() {
  if (ensured) return;
  try {
    const rows = await query(
      `SELECT DATA_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'caption'`
    );
    const type = String(rows[0]?.DATA_TYPE || "").toLowerCase();
    if (type && type !== "longtext") {
      await query(`ALTER TABLE social_posts MODIFY caption LONGTEXT NULL`);
    }

    // Per-destination link table. UNIQUE(post_id, page_id) prevents the same
    // page being added twice to one post (§9). No FKs (kept lenient like the
    // rest of this module); page metadata is resolved live from social_pages.
    await query(
      `CREATE TABLE IF NOT EXISTS social_post_destinations (
         id INT AUTO_INCREMENT PRIMARY KEY,
         post_id INT NOT NULL,
         platform VARCHAR(32) NULL,
         page_id INT NOT NULL,
         post_link VARCHAR(1024) NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uq_post_page (post_id, page_id),
         KEY idx_post (post_id),
         KEY idx_page (page_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // One-time backfill: every legacy post that has a page_id but no destination
    // row becomes a single destination (platform from its page, link from the
    // old external_url), so nothing that existed before this change is lost.
    await query(
      `INSERT IGNORE INTO social_post_destinations (post_id, platform, page_id, post_link)
       SELECT p.id, sp.platform, p.page_id, p.external_url
         FROM social_posts p
         JOIN social_pages sp ON sp.id = p.page_id
        WHERE p.page_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM social_post_destinations d WHERE d.post_id = p.id)`
    );

    ensured = true;
  } catch (e) {
    console.error("[social] ensureSocialPostSchema:", e?.message || e);
  }
}

// Normalize an incoming destinations payload into clean rows. Accepts
// [{platform, page_id, post_link}]; dedupes by page_id (§9); drops rows with no
// valid page_id. Returns [] when nothing valid.
export function normalizeDestinations(input) {
  const seen = new Set();
  const out = [];
  for (const d of Array.isArray(input) ? input : []) {
    const pageId = Number(d?.page_id);
    if (!Number.isInteger(pageId) || pageId <= 0 || seen.has(pageId)) continue;
    seen.add(pageId);
    out.push({
      page_id: pageId,
      platform: d?.platform ? String(d.platform).trim().toLowerCase() : null,
      post_link: d?.post_link != null && String(d.post_link).trim() ? String(d.post_link).trim() : null,
    });
  }
  return out;
}
