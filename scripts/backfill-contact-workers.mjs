// Backfill: every contact should have a linked worker (the app's invariant
// "one person = one worker + one contact"). A handful of contacts predate
// worker_id linking and have no matching worker — this creates + links the
// missing worker rows so the Workers page's Calling tab can show every
// contact. Idempotent; safe to re-run.
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
  const [contacts] = await conn.query("SELECT * FROM contacts WHERE worker_id IS NULL");
  console.log(`contacts with no linked worker: ${contacts.length}`);

  let created = 0;
  for (const c of contacts) {
    const firstPos = c.designation_id
      ? (await conn.query("SELECT name FROM designations WHERE id = ? LIMIT 1", [c.designation_id]))[0][0]?.name ?? null
      : null;
    if (DRY) { created++; continue; }
    const [res] = await conn.query(
      `INSERT INTO workers (name, mobile, address, position, zone_id, lok_sabha_id, district_id, assembly_id, ward_id, booth_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [c.person_name, c.phone_number, c.address ?? null, firstPos, c.zone_id ?? null, c.lok_sabha_id ?? null,
       c.district_id ?? null, c.assembly_id ?? null, c.ward_id ?? null, c.booth_id ?? null]
    );
    await conn.query("UPDATE contacts SET worker_id = ? WHERE id = ?", [res.insertId, c.id]);
    created++;
  }

  console.log(DRY ? `[dry] would create ${created} workers` : `created ${created} workers and linked them back to their contact`);
} finally {
  await conn.end();
}
