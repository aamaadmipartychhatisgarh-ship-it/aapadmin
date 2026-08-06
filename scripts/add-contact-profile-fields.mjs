// Extra profile fields for a contact, surfaced by the enhanced Contact Profile
// modal (view + edit): pincode, village/city, free-text remarks, and an
// updated_at timestamp so the modal can show "Last Updated". All nullable and
// additive — every read/write path detects columns defensively, so the app
// keeps working whether or not this migration has run. Idempotent.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const c = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});

async function hasColumn(name) {
  const [rows] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND COLUMN_NAME = ?`,
    [name]
  );
  return Number(rows[0].n) > 0;
}

async function addColumn(name, ddl) {
  if (await hasColumn(name)) { console.log(`contacts.${name} already exists.`); return; }
  await c.query(`ALTER TABLE contacts ADD COLUMN ${ddl}`);
  console.log(`added contacts.${name}`);
}

try {
  await addColumn("pincode", "pincode VARCHAR(12) NULL AFTER address");
  await addColumn("village", "village VARCHAR(255) NULL AFTER pincode");
  await addColumn("remarks", "remarks TEXT NULL AFTER village");
  // updated_at auto-maintains on every row change, so the modal's "Last Updated"
  // is always accurate without any app-side bookkeeping.
  await addColumn(
    "updated_at",
    "updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
  );
  console.log("done.");
} finally {
  await c.end();
}
