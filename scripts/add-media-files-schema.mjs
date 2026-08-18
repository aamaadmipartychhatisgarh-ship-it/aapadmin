// Media Center uploads (newspaper cuttings / coverage scans, debate briefs,
// social media, etc.) stored in the DB instead of only on local disk. As with
// worker/user photos, public/uploads/ does NOT survive Hostinger's
// auto-deploy-on-every-push cycle — files get wiped on redeploy while
// press_notes.file_url (in the persistent MariaDB) still points at them, so a
// newspaper cutting silently 404s after a refresh/redeploy. This table gives
// them durable storage. The `id` is the same uuid used in the existing
// /uploads/<uuid>.<ext> URL, so nothing that reads file_url needs to change —
// /api/media/[file] serves from here before falling back to disk.
//
// The app also creates this table lazily on first upload (see
// src/lib/mediaFileStore.js); this script just lets you provision it up front.
//
//   node scripts/add-media-files-schema.mjs   (idempotent)

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
    CREATE TABLE IF NOT EXISTS media_files (
      id CHAR(36) PRIMARY KEY,
      mime_type VARCHAR(100) NOT NULL,
      ext VARCHAR(10) NOT NULL,
      size INT NULL,
      data LONGBLOB NOT NULL,
      created_by_user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("= media_files table present");
  console.log("Note: durable storage of large files requires the MySQL/MariaDB");
  console.log("      max_allowed_packet to exceed the file size (the app caps");
  console.log("      uploads at 25 MB and falls back to disk if the DB rejects a blob).");
  console.log("Done.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
