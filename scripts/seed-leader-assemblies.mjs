import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Seed the Leader Assessment assembly master list from the REAL districts in
// `locations`. Each la_assemblies row uses only real location data — the
// district name and its parent lok_sabha (from the existing hierarchy). No MLA,
// candidate, election, vote or caste data is created; those are entered by
// admins in the UI and stay empty ("Not Available") until then.
//
// Idempotent: only inserts a district that isn't already present (matched by
// name), so it never duplicates and never overwrites admin-added assemblies.
// The app also seeds this lazily on first API use; this script is the explicit
// manual path (parity with scripts/seed-districts.mjs).
async function seedLeaderAssemblies() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aapadmin',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  });

  try {
    console.log('Seeding Leader Assessment assemblies from districts...');
    const [res] = await connection.query(
      `INSERT INTO la_assemblies (name, district, lok_sabha)
         SELECT d.name, d.name, ls.name
           FROM locations d
           LEFT JOIN locations ls ON ls.id = d.parent_id AND ls.type = 'lok_sabha'
          WHERE d.type = 'district'
            AND NOT EXISTS (SELECT 1 FROM la_assemblies a WHERE a.name = d.name)
          ORDER BY d.name ASC`
    );
    const [[{ total }]] = await connection.query('SELECT COUNT(*) AS total FROM la_assemblies');
    console.log(`\nDone! Inserted ${res.affectedRows} assemblies. Total now: ${total}.`);
  } catch (error) {
    console.error('Error seeding leader assemblies:', error);
  } finally {
    await connection.end();
  }
}

seedLeaderAssemblies();
