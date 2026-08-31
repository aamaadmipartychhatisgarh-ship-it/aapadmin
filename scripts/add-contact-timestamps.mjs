// Audit timestamps on contacts, so a persistence question — "did my edit stick,
// and when was it last changed?" — can be answered from the row itself, and a
// support engineer can distinguish a genuinely-recent edit from a stale one.
//   updated_at        — auto-maintained: stamped by the app on every contact
//                       edit (see /api/contacts/[id] and the supervisor route),
//                       and by the DB on ANY UPDATE via ON UPDATE CURRENT_TIMESTAMP.
//   photo_updated_at  — stamped when a photo is set/replaced/cleared via
//                       /api/contacts/[id]/photo, so a vanished photo can be
//                       traced to WHEN it changed.
// Backfills existing rows from created_at (or NOW() when that is absent) so the
// column is never NULL for pre-existing contacts. Idempotent.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const c = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});

async function hasColumn(name) {
  const [col] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND COLUMN_NAME = ?`,
    [name]
  );
  return Number(col[0].n) > 0;
}

try {
  const hasCreated = await hasColumn("created_at");

  if (await hasColumn("updated_at")) {
    console.log("contacts.updated_at already exists.");
  } else {
    // ON UPDATE keeps it fresh even for writes that don't go through the app.
    await c.query(
      "ALTER TABLE contacts ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    );
    const [r] = await c.query(
      hasCreated
        ? "UPDATE contacts SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL"
        : "UPDATE contacts SET updated_at = NOW() WHERE updated_at IS NULL"
    );
    console.log(`added contacts.updated_at (backfilled ${r.affectedRows} row(s)).`);
  }

  if (await hasColumn("photo_updated_at")) {
    console.log("contacts.photo_updated_at already exists.");
  } else {
    await c.query("ALTER TABLE contacts ADD COLUMN photo_updated_at TIMESTAMP NULL DEFAULT NULL");
    console.log("added contacts.photo_updated_at");
  }
} finally {
  await c.end();
}
