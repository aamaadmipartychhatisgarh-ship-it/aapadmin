// Worker profile photos, stored in the DB instead of local disk. Local disk
// storage (public/uploads/) doesn't survive Hostinger's auto-deploy-on-every-
// push cycle — files get wiped on redeploy while workers.photo_url (in the
// persistent MariaDB instance) still points at them, so photos silently
// disappear. This table gives worker photos durable storage. The `id` is the
// same uuid used in the existing /uploads/<uuid>.<ext> URL format, so no
// change is needed anywhere photo_url is read or rendered.
//
//   node scripts/add-worker-photos-schema.mjs   (idempotent)

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
    CREATE TABLE IF NOT EXISTS worker_photos (
      id CHAR(36) PRIMARY KEY,
      mime_type VARCHAR(30) NOT NULL,
      data MEDIUMBLOB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("= worker_photos table present");
  console.log("Done.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
