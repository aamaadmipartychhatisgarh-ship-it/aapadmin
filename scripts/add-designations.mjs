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
    console.log('Creating designations table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS designations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE
      );
    `);

    // Add designation_id to calls table if it doesn't exist
    const [columns] = await connection.query(`SHOW COLUMNS FROM calls LIKE 'designation_id'`);
    if (columns.length === 0) {
      console.log('Adding designation_id to calls table...');
      await connection.query(`ALTER TABLE calls ADD COLUMN designation_id INT AFTER destination`);
      await connection.query(`ALTER TABLE calls ADD FOREIGN KEY (designation_id) REFERENCES designations(id) ON DELETE SET NULL`);
      console.log('Successfully added designation_id.');
    } else {
      console.log('designation_id already exists in calls table.');
    }
    
    // Insert some defaults
    await connection.query(`INSERT IGNORE INTO designations (name) VALUES ('District President'), ('Block President'), ('Booth Worker'), ('Coordinator')`);
    
    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await connection.end();
  }
}

migrate();
