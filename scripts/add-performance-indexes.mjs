import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Indexes that keep the hot, frequently-polled paths off full table scans.
// Missing these lets slow queries hold DB connections (and the server
// processes behind each request) long enough to exhaust the host's process
// cap and 503 the app under load.
const INDEXES = [
  // Admin overview polls calls by date range every 30s.
  { table: 'calls', name: 'idx_calls_called_at', cols: '(called_at)' },
  // Workers list default sort: ORDER BY activity_score DESC, id DESC.
  { table: 'workers', name: 'idx_workers_score', cols: '(activity_score, id)' },
];

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aapadmin',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  });
  try {
    for (const ix of INDEXES) {
      const [rows] = await conn.query(
        `SHOW INDEX FROM \`${ix.table}\` WHERE Key_name = ?`, [ix.name]
      );
      if (rows.length) {
        console.log(`= ${ix.name} already exists on ${ix.table}, skipping`);
        continue;
      }
      console.log(`+ creating ${ix.name} on ${ix.table} ${ix.cols} ...`);
      await conn.query(`CREATE INDEX \`${ix.name}\` ON \`${ix.table}\` ${ix.cols}`);
    }
    console.log('Done.');
  } catch (err) {
    console.error('Index migration failed:', err);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

run();
