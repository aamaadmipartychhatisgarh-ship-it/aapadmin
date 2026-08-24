import { query } from "@/lib/db";

// Lazy, idempotent schema patch for social_pages: adds `photo_url` (the page's
// DP / profile photo). Stored as a durable /uploads/<uuid> URL from the shared
// uploader (/api/uploads → media_files blob store), so the DP survives refresh,
// re-login and redeploys — the same mechanism Contacts/Spokesperson photos use.
// Runs once per process (the deploy flow has no manual migration step); safe to
// call on every social-page read/write path.
let ensured = false;

export async function ensureSocialPageSchema() {
  if (ensured) return;
  try {
    const rows = await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_pages' AND COLUMN_NAME = 'photo_url'`
    );
    if (Number(rows[0]?.n || 0) === 0) {
      await query(`ALTER TABLE social_pages ADD COLUMN photo_url VARCHAR(512) NULL`);
    }
    ensured = true;
  } catch (e) {
    console.error("[social] ensureSocialPageSchema:", e?.message || e);
  }
}
