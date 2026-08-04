// Worker Type — Full Time / Part Time / Volunteer / Office Staff / Consultant.
// Additive, nullable (existing ~7,000 workers have no known type — leave
// blank rather than guessing). Idempotent.
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
const hasIndex = async (name) => {
  const [r] = await c.query(
    `SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='workers' AND INDEX_NAME=?`, [name]);
  return Number(r[0].n) > 0;
};
try {
  if (!(await has("worker_type"))) {
    await c.query(
      "ALTER TABLE workers ADD COLUMN worker_type ENUM('full_time','part_time','volunteer','office_staff','consultant') NULL"
    );
    console.log("Added workers.worker_type");
  } else {
    console.log("workers.worker_type already exists");
  }
  if (!(await hasIndex("idx_workers_type"))) {
    await c.query("ALTER TABLE workers ADD INDEX idx_workers_type (worker_type)");
    console.log("Added idx_workers_type");
  }
} finally {
  await c.end();
}
