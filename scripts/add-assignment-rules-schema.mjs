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
  console.log('1. Creating assignment_rules table...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS assignment_rules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      caller_user_id INT NOT NULL,
      designation_ids VARCHAR(255) NULL,   -- CSV of designation ids; empty = any designation
      zone_id INT NULL,
      lok_sabha_id INT NULL,
      district_id INT NULL,
      assembly_id INT NULL,
      daily_quota INT NOT NULL DEFAULT 100,
      stale_days INT NOT NULL DEFAULT 3,   -- reclaim matching contacts assigned elsewhere but untouched this long
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_caller (caller_user_id, is_active),
      FOREIGN KEY (caller_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  console.log('2. Adding contacts.assigned_at (so we know how long a contact has been held)...');
  const [col] = await conn.query(`SHOW COLUMNS FROM contacts LIKE 'assigned_at'`);
  if (col.length === 0) {
    await conn.query(`ALTER TABLE contacts ADD COLUMN assigned_at TIMESTAMP NULL AFTER assigned_to_user_id`);
    // Seed a baseline for already-assigned contacts so reclaim has a reference point.
    await conn.query(`UPDATE contacts SET assigned_at = COALESCE(created_at, NOW()) WHERE assigned_to_user_id IS NOT NULL AND assigned_at IS NULL`);
    console.log('   + added contacts.assigned_at');
  } else {
    console.log('   = contacts.assigned_at already present');
  }

  console.log('Done.');
} catch (err) {
  console.error('Migration failed:', err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
