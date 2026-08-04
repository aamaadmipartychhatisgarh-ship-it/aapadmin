// Server-persisted Saved Filters for the Reports Center — replaces the old
// localStorage-only "Save" button (per-browser, not shareable, lost on a
// device switch). One row per saved view; config carries everything needed
// to restore it (time range, filters, geo, search, group_by, view). Idempotent.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});
try {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saved_reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      module_key VARCHAR(64) NOT NULL,
      name VARCHAR(120) NOT NULL,
      config JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_module_name (user_id, module_key, name),
      INDEX idx_user_module (user_id, module_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  console.log("saved_reports table ready.");
} finally {
  await conn.end();
}
