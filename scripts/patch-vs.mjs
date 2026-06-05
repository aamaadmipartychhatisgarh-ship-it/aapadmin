import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Fill in VS for the new (2022) districts that had 0 seats attached.
// Best-effort mapping from the 2023 delimitation.
const MISSING = {
  "Balod": ["Sanjari Balod", "Dondi Lohara", "Gunderdehi"],
  "Balrampur-Ramanujganj": ["Ramanujganj", "Samri"], // these were also added under Surguja; OK to duplicate intent — admin can prune
  "Khairagarh-Chhuikhadan-Gandai": ["Khairagarh"],
  "Manendragarh-Chirmiri-Bharatpur(M C B)": ["Manendragarh-MCB"],
  "Mohla-Manpur-Ambagarh Chouki": ["Mohla-Manpur"],
  "Sarangarh-Bilaigarh": ["Sarangarh", "Bilaigarh"],
};

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aapadmin',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

try {
  let added = 0;
  for (const [distName, seats] of Object.entries(MISSING)) {
    const [rows] = await conn.query(`SELECT id FROM locations WHERE type='district' AND name=? LIMIT 1`, [distName]);
    if (!rows[0]) { console.warn('District not found:', distName); continue; }
    const distId = rows[0].id;
    for (const vs of seats) {
      // Avoid double-inserts if script is run twice
      const [exists] = await conn.query(`SELECT id FROM locations WHERE type='assembly' AND name=? AND parent_id=? LIMIT 1`, [vs, distId]);
      if (exists[0]) continue;
      await conn.query(`INSERT INTO locations (type, name, parent_id) VALUES ('assembly', ?, ?)`, [vs, distId]);
      added++;
    }
  }
  const [[fc]] = await conn.query(`SELECT COUNT(*) AS vs FROM locations WHERE type='assembly'`);
  console.log(`Added ${added} VS. Total VS: ${fc.vs}`);
} finally {
  await conn.end();
}
