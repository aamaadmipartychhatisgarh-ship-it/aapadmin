import { query } from "@/lib/db";

let ensured = false;

// team_members was created with worker_id only. Teams now also hold user
// accounts (callers etc.) so calls and tasks can be routed to them. The
// column is added lazily on first use because the Hostinger deploy flow has
// no manual migration step. scripts/add-user-team-members.mjs applies the
// same change for local/manual runs.
export async function ensureUserTeamMembers() {
  if (ensured) return;
  const cols = await query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'team_members' AND COLUMN_NAME = 'user_id'`
  );
  if (cols.length === 0) {
    await query(
      `ALTER TABLE team_members
         MODIFY worker_id INT NULL,
         ADD COLUMN user_id INT NULL AFTER worker_id,
         ADD UNIQUE KEY uniq_team_user (team_id, user_id),
         ADD CONSTRAINT fk_team_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`
    );
  }
  ensured = true;
}
