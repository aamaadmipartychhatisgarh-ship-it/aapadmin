// Adds tasks.start_date / duration_preset / duration_days so the task form can
// pick a duration (One Day … One Month, or Custom) and auto-calculate the
// deadline from it. Existing tasks keep their current deadline untouched —
// start_date/duration are left NULL until edited. Idempotent.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const c = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});
try {
  const [cols] = await c.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks'
        AND COLUMN_NAME IN ('start_date', 'duration_preset', 'duration_days')`
  );
  const have = new Set(cols.map((r) => r.COLUMN_NAME));
  if (!have.has("start_date")) {
    await c.query("ALTER TABLE tasks ADD COLUMN start_date DATE NULL AFTER deadline");
    console.log("added tasks.start_date");
  }
  if (!have.has("duration_preset")) {
    await c.query(
      "ALTER TABLE tasks ADD COLUMN duration_preset ENUM('one_day','two_days','three_days','one_week','two_weeks','one_month','custom') NULL AFTER start_date"
    );
    console.log("added tasks.duration_preset");
  }
  if (!have.has("duration_days")) {
    await c.query("ALTER TABLE tasks ADD COLUMN duration_days INT NULL AFTER duration_preset");
    console.log("added tasks.duration_days");
  }
  if (have.size === 3) console.log("tasks duration columns already exist.");
} finally {
  await c.end();
}
