// Moves the Raigarh Lok Sabha from Bilaspur zone to Sarguja zone.
// Idempotent — safe to run more than once. The same fix can also be done in
// the UI: Master Data → Political Locations → Raigarh (Lok Sabha) → pencil
// icon → pick Sarguja as the Zone.
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aapadmin',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  });
  try {
    const [[zone]] = await conn.query(
      `SELECT id, name FROM locations WHERE type = 'zone' AND (name LIKE '%SARGUJA%' OR name LIKE '%SURGUJA%') LIMIT 1`
    );
    if (!zone) { console.error('Sarguja zone not found.'); process.exit(1); }
    const [[ls]] = await conn.query(
      `SELECT id, name, parent_id FROM locations WHERE type = 'lok_sabha' AND name LIKE '%RAIGARH%' LIMIT 1`
    );
    if (!ls) { console.error('Raigarh Lok Sabha not found.'); process.exit(1); }
    if (ls.parent_id === zone.id) {
      console.log(`${ls.name} is already under ${zone.name}. Nothing to do.`);
      return;
    }
    await conn.query(`UPDATE locations SET parent_id = ? WHERE id = ?`, [zone.id, ls.id]);
    console.log(`Moved ${ls.name} (Lok Sabha) under ${zone.name} (zone).`);
  } finally {
    await conn.end();
  }
}

migrate().catch((e) => { console.error(e); process.exit(1); });
