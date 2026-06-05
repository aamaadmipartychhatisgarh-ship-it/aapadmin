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

try {
  console.log('1. Expanding users.role enum to 8 roles (+ legacy aliases)...');
  // Legacy values (admin, user, agent) are kept so existing rows and any
  // not-yet-migrated code keep working. New canonical roles added alongside.
  await conn.query(`
    ALTER TABLE users MODIFY COLUMN role ENUM(
      'super_admin','state_admin','zone_admin','district_admin','assembly_admin',
      'supervisor','caller','worker',
      'admin','user','agent'
    ) NOT NULL DEFAULT 'caller'
  `);

  console.log('2. Adding geographic scope columns...');
  const scopeCols = [
    { name: 'scope_zone_id', def: 'INT NULL' },
    { name: 'scope_lok_sabha_id', def: 'INT NULL' },
    { name: 'scope_assembly_id', def: 'INT NULL' },
  ];
  for (const col of scopeCols) {
    const [exists] = await conn.query(`SHOW COLUMNS FROM users LIKE '${col.name}'`);
    if (exists.length === 0) {
      await conn.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.def}`);
      console.log(`   + ${col.name}`);
    }
  }
  // home_district_id already exists and serves as scope_district_id.

  console.log('3. Migrating legacy roles to canonical names...');
  // admin -> super_admin, user -> caller, agent -> caller. supervisor stays.
  await conn.query(`UPDATE users SET role = 'super_admin' WHERE role = 'admin'`);
  await conn.query(`UPDATE users SET role = 'caller' WHERE role IN ('user','agent')`);

  console.log('4. Verify...');
  const [rows] = await conn.query(`SELECT id, username, role, home_district_id, scope_zone_id, scope_assembly_id FROM users`);
  rows.forEach(r => console.log(`   ${r.username}: ${r.role}`));

  console.log('Done.');
} catch (err) {
  console.error('Migration failed:', err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
