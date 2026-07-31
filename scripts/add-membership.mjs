// Membership lifecycle on the worker (member) registry: a stable membership no,
// join date, status and validity. Additive columns only; backfills existing
// members with a deterministic number + join date. Idempotent.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const c = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});
const has = async (col) => {
  const [r] = await c.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='workers' AND COLUMN_NAME=?`, [col]);
  return Number(r[0].n) > 0;
};
try {
  if (!(await has("membership_no"))) await c.query("ALTER TABLE workers ADD COLUMN membership_no VARCHAR(32) NULL");
  if (!(await has("member_since"))) await c.query("ALTER TABLE workers ADD COLUMN member_since DATE NULL");
  if (!(await has("membership_status"))) await c.query("ALTER TABLE workers ADD COLUMN membership_status ENUM('prospect','active','lapsed') NOT NULL DEFAULT 'active'");
  if (!(await has("valid_till"))) await c.query("ALTER TABLE workers ADD COLUMN valid_till DATE NULL");
  // Backfill: deterministic membership number + join date for existing members.
  const [bf] = await c.query(
    `UPDATE workers
        SET membership_no = COALESCE(membership_no, CONCAT('AAPCG', LPAD(id, 6, '0'))),
            member_since = COALESCE(member_since, DATE(created_at))
      WHERE membership_no IS NULL OR member_since IS NULL`
  );
  console.log(`membership columns ready; backfilled ${bf.affectedRows} members.`);
} finally {
  await c.end();
}
