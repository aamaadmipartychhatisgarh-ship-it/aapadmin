// One-time data repair: for linked worker<->contact pairs (same person, matched
// by worker_id), copy the WORKER's name onto the CONTACT when they differ. The
// Workers page is the single source of truth, so the Contacts page must display
// the same name for the same person. Name drift crept in when a worker and a
// contact for the same phone were created independently and later linked by phone
// without reconciling the name. Going forward the worker<->contact sync keeps
// them in step on every edit; this fixes the legacy rows. Idempotent.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const DRY = process.argv.includes("--dry");

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});
try {
  const [rows] = await conn.query(
    `SELECT c.id AS contact_id, c.person_name AS c_name, w.name AS w_name
       FROM contacts c JOIN workers w ON w.id = c.worker_id
      WHERE TRIM(c.person_name) <> TRIM(w.name) AND w.name IS NOT NULL AND TRIM(w.name) <> ''`
  );
  console.log(`linked pairs with name drift: ${rows.length}`);
  if (DRY) { rows.slice(0, 20).forEach((r) => console.log(`  "${r.c_name}" -> "${r.w_name}"`)); await conn.end(); process.exit(0); }
  let n = 0;
  for (const r of rows) {
    await conn.query("UPDATE contacts SET person_name = ? WHERE id = ?", [r.w_name, r.contact_id]);
    n++;
  }
  console.log(`synced ${n} contact names from their worker.`);
} finally {
  await conn.end();
}
