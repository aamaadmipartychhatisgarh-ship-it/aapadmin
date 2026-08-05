// Caller/staff profile photos — mirrors worker_photos exactly (see
// scripts/add-worker-photos-schema.mjs for the rationale: DB storage survives
// Hostinger's auto-deploy-on-every-push cycle, local disk doesn't). Also adds
// users.photo_url so the header/profile page has somewhere to point.
//
//   node scripts/add-user-photos-schema.mjs   (idempotent)

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "aapadmin",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

try {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS user_photos (
      id CHAR(36) PRIMARY KEY,
      mime_type VARCHAR(30) NOT NULL,
      data MEDIUMBLOB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("= user_photos table present");

  const [cols] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'photo_url'`
  );
  if (Number(cols[0].n) > 0) {
    console.log("users.photo_url already exists.");
  } else {
    await conn.query("ALTER TABLE users ADD COLUMN photo_url VARCHAR(255) NULL AFTER username");
    console.log("added users.photo_url");
  }
  console.log("Done.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
