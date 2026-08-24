import { query } from "@/lib/db";

// Lazy, idempotent schema patch for social_posts: the post content (`caption`)
// was TEXT (~64 KB), which caps very long posts. Log a Post now allows
// unlimited long-form content (no word/character limit), so widen it to
// LONGTEXT (up to 4 GB) — the content is never truncated on save. Runs once per
// process; safe to call on every post write path.
let ensured = false;

export async function ensureSocialPostSchema() {
  if (ensured) return;
  try {
    const rows = await query(
      `SELECT DATA_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'caption'`
    );
    const type = String(rows[0]?.DATA_TYPE || "").toLowerCase();
    // Upgrade anything smaller than longtext (text/mediumtext/varchar) in place.
    if (type && type !== "longtext") {
      await query(`ALTER TABLE social_posts MODIFY caption LONGTEXT NULL`);
    }
    ensured = true;
  } catch (e) {
    console.error("[social] ensureSocialPostSchema:", e?.message || e);
  }
}
