// Master Task + Sub Task (checklist) support. Each task can hold unlimited
// checklist items; completing all of them auto-completes the master task.
// Idempotent.
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
    `CREATE TABLE IF NOT EXISTS task_subtasks (
       id INT AUTO_INCREMENT PRIMARY KEY,
       task_id INT NOT NULL,
       title VARCHAR(500) NOT NULL,
       is_completed TINYINT(1) NOT NULL DEFAULT 0,
       completed_by_user_id INT NULL,
       completed_at TIMESTAMP NULL DEFAULT NULL,
       sort_order INT NOT NULL DEFAULT 0,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_subtask_task (task_id)
     )`
  );
  console.log("task_subtasks table ready.");
} finally {
  await c.end();
}
