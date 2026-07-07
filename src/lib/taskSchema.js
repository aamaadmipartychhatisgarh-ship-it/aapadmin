import { query } from "@/lib/db";

let ensured = false;

// tasks gain an optional contact link so a task can be assigned "on" a contact
// and shown to the telecaller while they're calling that person. Applied lazily
// because the Hostinger deploy flow has no manual migration step.
export async function ensureTaskContactColumn() {
  if (ensured) return;
  const cols = await query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'contact_id'`
  );
  if (cols.length === 0) {
    await query(
      `ALTER TABLE tasks
         ADD COLUMN contact_id INT NULL,
         ADD INDEX idx_tasks_contact (contact_id),
         ADD CONSTRAINT fk_tasks_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL`
    );
  }
  ensured = true;
}
