import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aapadmin',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

async function loc(name, type) {
  const [r] = await conn.query(`SELECT id FROM locations WHERE name=? AND type=? LIMIT 1`, [name, type]);
  return r[0]?.id || null;
}

try {
  const raipurZone = await loc('Raipur', 'zone');
  const raipurDistrict = await loc('Raipur', 'district');
  const raipurAssembly = await loc('Raipur City Rural', 'assembly');

  console.log('Resolved locations:', { raipurZone, raipurDistrict, raipurAssembly });

  // Each scoped admin gets a sample territory for testing.
  await conn.query(`UPDATE users SET scope_zone_id = ? WHERE username = 'zoneadmin'`, [raipurZone]);
  await conn.query(`UPDATE users SET home_district_id = ? WHERE username = 'districtadmin'`, [raipurDistrict]);
  await conn.query(`UPDATE users SET scope_assembly_id = ? WHERE username = 'assemblyadmin'`, [raipurAssembly]);

  // Supervisor and worker also need a home district for scoping to make sense
  await conn.query(`UPDATE users SET home_district_id = ? WHERE username IN ('supervisor','caller','worker')`, [raipurDistrict]);

  const [rows] = await conn.query(
    `SELECT u.username, u.role, u.home_district_id, ld.name AS district, u.scope_zone_id, lz.name AS zone, u.scope_assembly_id, la.name AS assembly
       FROM users u
       LEFT JOIN locations ld ON ld.id = u.home_district_id
       LEFT JOIN locations lz ON lz.id = u.scope_zone_id
       LEFT JOIN locations la ON la.id = u.scope_assembly_id
       ORDER BY u.id`
  );
  console.log('\nScopes:');
  rows.forEach(r => console.log(`  ${r.username.padEnd(15)} ${r.role.padEnd(15)} zone=${r.zone || '—'}  district=${r.district || '—'}  assembly=${r.assembly || '—'}`));
  console.log('\nDone.');
} catch (err) {
  console.error('Failed:', err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
