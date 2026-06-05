import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aapadmin',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    multipleStatements: false,
  });

  try {
    console.log('1. Extending users.role to include supervisor...');
    await connection.query(
      `ALTER TABLE users MODIFY COLUMN role ENUM('admin','user','agent','supervisor') DEFAULT 'user'`
    );

    console.log('2. Adding users.last_seen_at and users.is_active...');
    const [lastSeenCol] = await connection.query(`SHOW COLUMNS FROM users LIKE 'last_seen_at'`);
    if (lastSeenCol.length === 0) {
      await connection.query(`ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMP NULL`);
    }
    const [isActiveCol] = await connection.query(`SHOW COLUMNS FROM users LIKE 'is_active'`);
    if (isActiveCol.length === 0) {
      await connection.query(`ALTER TABLE users ADD COLUMN is_active TINYINT(1) DEFAULT 1`);
    }

    console.log('3. Adding new columns to calls table...');
    const newCallColumns = [
      { name: 'duration_seconds', def: 'INT NULL' },
      { name: 'sentiment', def: "ENUM('positive','negative','neutral','supporter','opponent') NULL" },
      { name: 'is_follow_up_required', def: 'TINYINT(1) DEFAULT 0' },
      { name: 'follow_up_date', def: 'DATE NULL' },
      { name: 'is_vip', def: 'TINYINT(1) DEFAULT 0' },
    ];
    for (const col of newCallColumns) {
      const [exists] = await connection.query(`SHOW COLUMNS FROM calls LIKE '${col.name}'`);
      if (exists.length === 0) {
        await connection.query(`ALTER TABLE calls ADD COLUMN ${col.name} ${col.def}`);
        console.log(`   + added calls.${col.name}`);
      } else {
        console.log(`   = calls.${col.name} already exists`);
      }
    }

    console.log('4. Creating attendance_log table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS attendance_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        logout_at TIMESTAMP NULL,
        total_minutes INT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_attendance_user (user_id),
        INDEX idx_attendance_login (login_at)
      );
    `);

    console.log('5. Seeding Busy + Switched Off call statuses...');
    const extraStatuses = ['Busy', 'Switched Off'];
    for (const s of extraStatuses) {
      await connection.query(`INSERT IGNORE INTO call_statuses (name) VALUES (?)`, [s]);
    }

    console.log('Done.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

migrate();
