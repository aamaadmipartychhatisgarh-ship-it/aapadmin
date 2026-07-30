// Backfill: every worker with a mobile should have a linked contact (the app's
// invariant "one person = one worker + one contact"). Legacy imports left some
// workers without a contact row, so those people appear on Add Workers but not on
// Contacts for the same filters. This creates + links the missing contacts so the
// two pages return the same people. Idempotent; safe to re-run.
//
// Note: contacts.phone_number is NOT NULL, so workers WITHOUT a mobile cannot
// become contacts — those remain workers-only (reported at the end).
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const DRY = process.argv.includes("--dry");
const L10 = (c) => `RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${c},' ',''),'-',''),'+',''),'(',''),')',''),'.',''),10)`;

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});

try {
  const [workers] = await conn.query(
    `SELECT w.* FROM workers w
      WHERE w.mobile IS NOT NULL AND w.mobile <> ''
        AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.worker_id = w.id)`
  );
  console.log(`workers with a mobile but no linked contact: ${workers.length}`);
  const [[phoneless]] = await conn.query(
    `SELECT COUNT(*) n FROM workers w WHERE (w.mobile IS NULL OR w.mobile='')
       AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.worker_id = w.id)`
  );

  let created = 0, linked = 0;
  for (const w of workers) {
    // Primary designation = first entry of the (possibly multi-value) position.
    const firstPos = String(w.position || "").split(",")[0].trim();
    let designationId = null;
    if (firstPos) {
      const [[d]] = await conn.query("SELECT id FROM designations WHERE name = ? LIMIT 1", [firstPos]);
      designationId = d?.id ?? null;
    }
    if (DRY) { created++; continue; }
    try {
      const [res] = await conn.query(
        `INSERT INTO contacts (person_name, phone_number, address, designation_id, zone_id, lok_sabha_id, district_id, assembly_id, ward_id, booth_id, worker_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [w.name, w.mobile, w.address ?? null, designationId, w.zone_id ?? null, w.lok_sabha_id ?? null,
         w.district_id ?? null, w.assembly_id ?? null, w.ward_id ?? null, w.booth_id ?? null, w.id]
      );
      created++;
      if (res.insertId % 1 === 0 && created % 100 === 0) console.log(`  …${created}`);
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        // A contact with this phone already exists but wasn't linked — link it.
        const [c] = await conn.query(`SELECT id FROM contacts WHERE ${L10("phone_number")} = ${L10("?")} LIMIT 1`, [w.mobile]);
        if (c.length) { await conn.query("UPDATE contacts SET worker_id = ? WHERE id = ?", [w.id, c[0].id]); linked++; }
      } else { throw e; }
    }
  }

  console.log(DRY ? `[dry] would create ${created} contacts` : `created ${created} contacts, linked ${linked} existing`);
  console.log(`workers WITHOUT a mobile (cannot become contacts — contacts require a phone): ${phoneless.n}`);
} finally {
  await conn.end();
}
