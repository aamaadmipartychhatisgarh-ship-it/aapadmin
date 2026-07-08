import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Contacts created from workers never got a designation. Backfill each contact's
// designation_id from its matching worker's primary (first) designation name,
// where that name exists in the master designations list. Matched by phone.
async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aapadmin',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  });
  try {
    const [res] = await conn.query(`
      UPDATE contacts c
        JOIN workers w ON w.mobile = c.phone_number
        JOIN designations d ON d.name = TRIM(SUBSTRING_INDEX(w.position, ',', 1))
         SET c.designation_id = d.id
       WHERE c.designation_id IS NULL
         AND w.position IS NOT NULL AND w.position <> ''
    `);
    console.log(`Backfilled designation_id on ${res.affectedRows} contact(s).`);
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

run();
