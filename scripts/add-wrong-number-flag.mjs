// Adds contacts.is_wrong_number so "Wrong Number" contacts move to a dedicated
// list (out of the calling queue) until manually restored.
//
// Run:  node scripts/add-wrong-number-flag.mjs   (uses .env.local)
// Idempotent: safe to re-run.

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const c = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "aapadmin",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

try {
  const [col] = await c.query("SHOW COLUMNS FROM contacts LIKE 'is_wrong_number'");
  if (col.length === 0) {
    await c.query(
      "ALTER TABLE contacts ADD COLUMN is_wrong_number TINYINT(1) NOT NULL DEFAULT 0 AFTER is_completed"
    );
    console.log("+ added contacts.is_wrong_number");
    // Backfill: flag contacts whose most recent call outcome was "Wrong Number".
    const [res] = await c.query(
      `UPDATE contacts ct
          SET ct.is_wrong_number = 1
        WHERE (
          SELECT cs.name FROM calls cx
            JOIN call_statuses cs ON cs.id = cx.status_id
           WHERE cx.contact_id = ct.id
           ORDER BY cx.called_at DESC, cx.id DESC LIMIT 1
        ) = 'Wrong Number'`
    );
    console.log(`  backfilled ${res.affectedRows} existing wrong-number contacts`);
  } else {
    console.log("= contacts.is_wrong_number already present");
  }
  console.log("Done.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await c.end();
}
