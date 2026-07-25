// Adds contacts.worker_id — a stable link between a contact and its worker row —
// so contact<->worker sync uses an id, not the phone number. Backfills the link
// for existing rows by matching the last 10 digits of the phone.
//
// Run:  node scripts/link-contacts-workers.mjs   (uses .env.local)
// Idempotent: safe to re-run.

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const LAST10 = (c) =>
  `RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${c}, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10)`;

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "aapadmin",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

try {
  const [col] = await conn.query("SHOW COLUMNS FROM contacts LIKE 'worker_id'");
  if (col.length === 0) {
    await conn.query("ALTER TABLE contacts ADD COLUMN worker_id INT NULL, ADD INDEX idx_worker (worker_id)");
    console.log("+ added contacts.worker_id (+ index)");
  } else {
    console.log("= contacts.worker_id already present");
  }

  // Backfill: link each contact to the lowest-id worker sharing its phone (last 10).
  const [res] = await conn.query(
    `UPDATE contacts c
        SET c.worker_id = (
          SELECT MIN(w.id) FROM workers w
           WHERE w.mobile IS NOT NULL AND ${LAST10("w.mobile")} = ${LAST10("c.phone_number")}
        )
      WHERE c.worker_id IS NULL AND c.phone_number IS NOT NULL`
  );
  console.log(`  backfilled ${res.affectedRows} contact->worker links`);

  const [[{ linked }]] = await conn.query("SELECT COUNT(*) linked FROM contacts WHERE worker_id IS NOT NULL");
  const [[{ total }]] = await conn.query("SELECT COUNT(*) total FROM contacts");
  console.log(`  ${linked}/${total} contacts now linked to a worker`);
  console.log("Done.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
