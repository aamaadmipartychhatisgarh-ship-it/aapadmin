// Adds contacts.assigned_by_user_id so the caller's "Assigned to You" list can
// show WHO assigned each contact (supervisor / super admin) alongside the
// existing assigned_at timestamp. Idempotent.
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
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND COLUMN_NAME = 'assigned_by_user_id'`
  );
  if (Number(col[0].n) > 0) {
    console.log("assigned_by_user_id already exists — nothing to do.");
  } else {
    await c.query(`ALTER TABLE contacts ADD COLUMN assigned_by_user_id INT NULL AFTER assigned_to_user_id`);
    console.log("added contacts.assigned_by_user_id");
  }
} finally {
  await c.end();
}
