// Adds user-account membership to teams: team_members.user_id (FK users).
// The app also applies this lazily at runtime (src/lib/teamSchema.js), so
// running this script is optional — it exists for manual/local setups.
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
  });

  try {
    const [columns] = await connection.query(`SHOW COLUMNS FROM team_members LIKE 'user_id'`);
    if (columns.length === 0) {
      console.log('Adding user_id to team_members...');
      await connection.query(`
        ALTER TABLE team_members
          MODIFY worker_id INT NULL,
          ADD COLUMN user_id INT NULL AFTER worker_id,
          ADD UNIQUE KEY uniq_team_user (team_id, user_id),
          ADD CONSTRAINT fk_team_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      `);
      console.log('Done.');
    } else {
      console.log('team_members.user_id already exists.');
    }
  } finally {
    await connection.end();
  }
}

migrate().catch((e) => { console.error(e); process.exit(1); });
