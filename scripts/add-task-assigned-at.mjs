// Adds tasks.assigned_at (distinct from created_at) so the task list can sort by
// most-recent assignment and show an "Assigned On" column. Backfills existing
// rows to created_at. Idempotent.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const c = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});
try {
  const [col] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'assigned_at'`
  );
  if (Number(col[0].n) > 0) {
    console.log("tasks.assigned_at already exists.");
  } else {
    await c.query("ALTER TABLE tasks ADD COLUMN assigned_at TIMESTAMP NULL DEFAULT NULL AFTER created_at");
    console.log("added tasks.assigned_at");
  }
  const [r] = await c.query("UPDATE tasks SET assigned_at = created_at WHERE assigned_at IS NULL");
  console.log(`backfilled assigned_at on ${r.affectedRows} existing rows.`);
} finally {
  await c.end();
}
