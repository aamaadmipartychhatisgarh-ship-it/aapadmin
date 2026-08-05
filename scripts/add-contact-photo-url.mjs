// Contacts get their own native photo_url column, decoupling them from the
// (now-removed) Worker Management module — a contact's photo used to be
// stored on its linked worker's photo_url only. Backfills existing contacts
// from their linked worker's photo (one-time copy) so no photo already
// visible in the UI disappears; every contact photo saved from here on
// writes directly to this column, never touching `workers`. Idempotent.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const c = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});
try {
  const [col] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND COLUMN_NAME = 'photo_url'`
  );
  if (Number(col[0].n) > 0) {
    console.log("contacts.photo_url already exists.");
  } else {
    await c.query("ALTER TABLE contacts ADD COLUMN photo_url VARCHAR(500) NULL AFTER phone_number");
    console.log("added contacts.photo_url");
  }
  const [r] = await c.query(
    `UPDATE contacts c
       JOIN workers w ON w.id = c.worker_id
        SET c.photo_url = w.photo_url
      WHERE c.photo_url IS NULL AND w.photo_url IS NOT NULL`
  );
  console.log(`backfilled photo_url on ${r.affectedRows} contact(s) from their linked worker.`);
} finally {
  await c.end();
}
