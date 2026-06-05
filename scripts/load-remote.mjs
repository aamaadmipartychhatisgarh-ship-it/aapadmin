import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Loads _schema.sql then _seeddata.sql into the configured DB (remote Hostinger).
const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  multipleStatements: true,
  connectTimeout: 20000,
});

async function runFile(file) {
  const sql = await fs.readFile(path.resolve(process.cwd(), 'scripts', file), 'utf8');
  // Strip mysqldump session-var lines that can choke remote shared hosting.
  const cleaned = sql
    .split('\n')
    .filter((l) => !l.startsWith('/*!') || l.includes('40101 SET') === false ? true : true)
    .join('\n');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  await conn.query(cleaned);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log(`  ✓ loaded ${file}`);
}

try {
  console.log('Target:', process.env.DB_HOST, '/', process.env.DB_NAME);
  await runFile('_schema.sql');
  await runFile('_seeddata.sql');

  const [[t]] = await conn.query(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()`);
  const [[u]] = await conn.query(`SELECT COUNT(*) AS n FROM users`);
  const [[l]] = await conn.query(`SELECT COUNT(*) AS n FROM locations`);
  console.log(`\nDone. tables=${t.n}  users=${u.n}  locations=${l.n}`);
} catch (err) {
  console.error('Load failed:', err.sqlMessage || err.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
