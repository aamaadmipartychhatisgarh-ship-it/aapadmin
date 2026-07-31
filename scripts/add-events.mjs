// Events & Mobilization: meetings, rallies, booth events, trainings — with
// simple attendee tracking. Self-contained; no changes to existing tables.
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
    `CREATE TABLE IF NOT EXISTS events (
       id INT AUTO_INCREMENT PRIMARY KEY,
       title VARCHAR(255) NOT NULL,
       type VARCHAR(48) NOT NULL DEFAULT 'meeting',
       description TEXT NULL,
       event_date DATE NOT NULL,
       event_time TIME NULL,
       venue VARCHAR(255) NULL,
       district_id INT NULL,
       zone_id INT NULL,
       status ENUM('scheduled','ongoing','completed','cancelled') NOT NULL DEFAULT 'scheduled',
       created_by_user_id INT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_events_date (event_date),
       INDEX idx_events_status (status)
     )`
  );
  await c.query(
    `CREATE TABLE IF NOT EXISTS event_attendees (
       id INT AUTO_INCREMENT PRIMARY KEY,
       event_id INT NOT NULL,
       user_id INT NULL,
       worker_id INT NULL,
       rsvp ENUM('invited','yes','no','maybe') NOT NULL DEFAULT 'invited',
       attended TINYINT(1) NOT NULL DEFAULT 0,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_att_event (event_id)
     )`
  );
  console.log("events + event_attendees tables ready.");
} finally {
  await c.end();
}
