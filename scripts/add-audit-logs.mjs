// Audit trail for sensitive/destructive actions (assignments, deletions, user
// changes). One row per action; details holds a small JSON snapshot. Idempotent.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const c = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});
try {
  await c.query(
    `CREATE TABLE IF NOT EXISTS audit_logs (
       id INT AUTO_INCREMENT PRIMARY KEY,
       actor_user_id INT NULL,
       actor_name VARCHAR(255) NULL,
       action VARCHAR(64) NOT NULL,
       entity_type VARCHAR(64) NULL,
       entity_id VARCHAR(64) NULL,
       details TEXT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_audit_created (created_at),
       INDEX idx_audit_actor (actor_user_id),
       INDEX idx_audit_action (action)
     )`
  );
  console.log("audit_logs table ready.");
} finally {
  await c.end();
}
