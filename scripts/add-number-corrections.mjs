// Wrong Number / Switched Off sharing workflow — a caller flags a contact's
// number, a supervisor verifies and routes it to a Designation, whoever holds
// that designation (and has a login) submits a correction or rejects it, and
// a supervisor closes it out. One row captures the whole lifecycle with
// timestamps, so no separate history table is needed. Idempotent.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const c = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});
try {
  await c.query(`
    CREATE TABLE IF NOT EXISTS number_correction_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      contact_id INT NOT NULL,
      reason ENUM('wrong_number','switched_off') NOT NULL,
      note VARCHAR(500) NULL,
      original_phone_number VARCHAR(50) NOT NULL,
      reported_by_user_id INT NULL,
      reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      target_designation_id INT NULL,
      status ENUM('pending','rejected','corrected','resolved') NOT NULL DEFAULT 'pending',
      verified_by_user_id INT NULL,
      verified_at TIMESTAMP NULL,
      corrected_phone_number VARCHAR(50) NULL,
      corrected_by_user_id INT NULL,
      corrected_at TIMESTAMP NULL,
      resolved_by_user_id INT NULL,
      resolved_at TIMESTAMP NULL,
      rejected_by_user_id INT NULL,
      rejected_at TIMESTAMP NULL,
      rejection_reason VARCHAR(500) NULL,
      INDEX idx_contact (contact_id),
      INDEX idx_status (status),
      INDEX idx_designation (target_designation_id),
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
      FOREIGN KEY (reported_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (target_designation_id) REFERENCES designations(id) ON DELETE SET NULL,
      FOREIGN KEY (verified_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (corrected_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (rejected_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  console.log("number_correction_requests table ready.");
} finally {
  await c.end();
}
