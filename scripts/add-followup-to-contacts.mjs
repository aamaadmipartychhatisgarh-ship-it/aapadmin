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
  const [fu] = await conn.query(`SHOW COLUMNS FROM contacts LIKE 'follow_up_date'`);
  if (fu.length === 0) {
    await conn.query(`ALTER TABLE contacts ADD COLUMN follow_up_date DATE NULL`);
    await conn.query(`ALTER TABLE contacts ADD INDEX idx_followup (follow_up_date)`);
    console.log('+ added contacts.follow_up_date');
  }
  const [vip] = await conn.query(`SHOW COLUMNS FROM contacts LIKE 'is_vip'`);
  if (vip.length === 0) {
    await conn.query(`ALTER TABLE contacts ADD COLUMN is_vip TINYINT(1) DEFAULT 0`);
    console.log('+ added contacts.is_vip');
  }
  console.log('Done.');
} finally {
  await conn.end();
}
