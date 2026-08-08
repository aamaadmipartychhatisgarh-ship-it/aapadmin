import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Explicit, idempotent seed for the 33 Chhattisgarh Leader Assessment
// assemblies + their fixed Required-Worker targets. Mirrors the lazy seed the
// app runs on first API use (src/lib/leaderAssessment.js) — this is the manual
// path. No MLA / candidate / election / vote data is created; those are entered
// in the UI. Idempotent: matches an existing assembly by normalized name (or
// alias) and back-fills reference fields; never creates duplicates.
const ASSEMBLIES = [
  ['Balod', 6000, ['Balod']],
  ['Baloda Bazar', 6000, ['Baloda Bazar', 'Balodabazar-Bhatapara']],
  ['Balrampur', 4000, ['Balrampur', 'Balrampur-Ramanujganj']],
  ['Bastar', 6000, ['Bastar']],
  ['Bemetara', 6000, ['Bemetara']],
  ['Bijapur', 2000, ['Bijapur']],
  ['Bilaspur', 12000, ['Bilaspur']],
  ['Dantewada', 2000, ['Dantewada', 'Dakshin Bastar Dantewada']],
  ['Dhamtari', 6000, ['Dhamtari']],
  ['Durg', 12000, ['Durg']],
  ['Gariaband', 4000, ['Gariaband', 'Gariyaband']],
  ['Gaurela-Pendra-Marwahi', 2000, ['Gaurela-Pendra-Marwahi', 'Gaurella-Pendra-Marwahi']],
  ['Janjgir-Champa', 6000, ['Janjgir-Champa']],
  ['Jashpur', 6000, ['Jashpur']],
  ['Kabirdham', 4000, ['Kabirdham', 'Kabeerdham', 'Kawardha']],
  ['Kanker', 6000, ['Kanker', 'Uttar Bastar Kanker']],
  ['Khairagarh-Chhuikhadan-Gandai', 2000, ['Khairagarh-Chhuikhadan-Gandai']],
  ['Kondagaon', 4000, ['Kondagaon']],
  ['Korba', 8000, ['Korba']],
  ['Koriya', 4000, ['Koriya', 'Korea', 'Koria']],
  ['MCB (Manendragarh-Chirmiri-Bharatpur)', 2000, ['MCB', 'Manendragarh-Chirmiri-Bharatpur', 'Manendragarh-Chirmiri-Bharatpur(M C B)']],
  ['Mahasamund', 8000, ['Mahasamund']],
  ['Mohla-Manpur-Ambagarh Chowki', 2000, ['Mohla-Manpur-Ambagarh Chowki', 'Mohla-Manpur-Ambagarh Chouki']],
  ['Mungeli', 4000, ['Mungeli']],
  ['Narayanpur', 2000, ['Narayanpur']],
  ['Raigarh', 8000, ['Raigarh']],
  ['Raipur', 14000, ['Raipur']],
  ['Rajnandgaon', 8000, ['Rajnandgaon']],
  ['Sakti', 6000, ['Sakti']],
  ['Sarangarh-Bilaigarh', 4000, ['Sarangarh-Bilaigarh']],
  ['Sukma', 2000, ['Sukma']],
  ['Surajpur', 6000, ['Surajpur']],
  ['Surguja', 6000, ['Surguja']],
];

const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]/g, '');

async function seed() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aapadmin',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  });
  try {
    // Ensure the reference columns exist (parity with the app's lazy migration).
    for (const [col, def] of [['required_workers', 'INT NULL'], ['district_id', 'INT NULL']]) {
      const [c] = await connection.query(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='la_assemblies' AND COLUMN_NAME=?`, [col]);
      if (Number(c[0].n) === 0) await connection.query(`ALTER TABLE la_assemblies ADD COLUMN ${col} ${def}`);
    }
    const [districts] = await connection.query(`SELECT id, name FROM locations WHERE type='district'`);
    const districtByNorm = new Map(districts.map((d) => [norm(d.name), d.id]));
    const [existing] = await connection.query(`SELECT id, name FROM la_assemblies`);
    const existingByNorm = new Map(existing.map((r) => [norm(r.name), r]));

    let inserted = 0, updated = 0;
    for (const [name, required, aliases] of ASSEMBLIES) {
      let districtId = null;
      for (const al of aliases) { const id = districtByNorm.get(norm(al)); if (id) { districtId = id; break; } }
      let row = null;
      for (const al of [name, ...aliases]) { const r = existingByNorm.get(norm(al)); if (r) { row = r; break; } }
      if (row) {
        await connection.query(
          `UPDATE la_assemblies SET required_workers=COALESCE(required_workers,?), district_id=COALESCE(district_id,?) WHERE id=?`,
          [required, districtId, row.id]);
        updated++;
      } else {
        const [res] = await connection.query(
          `INSERT INTO la_assemblies (name, district, required_workers, district_id) VALUES (?,?,?,?)`,
          [name, name, required, districtId]);
        existingByNorm.set(norm(name), { id: res.insertId, name });
        inserted++;
      }
    }
    const [[{ total }]] = await connection.query('SELECT COUNT(*) AS total FROM la_assemblies');
    console.log(`Done. Inserted ${inserted}, back-filled ${updated}. Total assemblies: ${total}.`);
  } catch (error) {
    console.error('Error seeding leader assemblies:', error);
  } finally {
    await connection.end();
  }
}

seed();
