import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function initDb() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  });

  const dbName = process.env.DB_NAME || 'aapadmin';

  try {
    console.log(`Creating database ${dbName} if not exists...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await connection.query(`USE \`${dbName}\`;`);

    // Users table (admin/auth)
    console.log('Creating users table if not exists...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin', 'user', 'agent') DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure a default admin exists
    const [adminRows] = await connection.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    if (adminRows.length === 0) {
      console.log('No admin user found. Creating default admin (admin/admin)...');
      const hashedPassword = await bcrypt.hash('admin', 10);
      await connection.query(
        `INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
        ['admin', hashedPassword, 'admin']
      );
      console.log('Default admin created successfully.');
    } else {
      console.log('Admin user already exists.');
    }

    // Locations hierarchy table
    console.log('Creating locations table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS locations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type ENUM('zone','lok_sabha','district','assembly','ward','polling_station','booth') NOT NULL,
        parent_id INT NULL,
        FOREIGN KEY (parent_id) REFERENCES locations(id) ON DELETE SET NULL
      );
    `);
    
    // Seed dummy locations
    const [zoneRows] = await connection.query(`SELECT id FROM locations WHERE name = 'Central Zone' AND type='zone'`);
    let zoneId;
    if (zoneRows.length === 0) {
      const [{ insertId }] = await connection.query(`INSERT INTO locations (name, type) VALUES ('Central Zone', 'zone')`);
      zoneId = insertId;
    } else {
      zoneId = zoneRows[0].id;
    }

    const [lokSabhaRows] = await connection.query(`SELECT id FROM locations WHERE name = 'Raipur Lok Sabha' AND type='lok_sabha'`);
    let lokSabhaId;
    if (lokSabhaRows.length === 0) {
      const [{ insertId }] = await connection.query(`INSERT INTO locations (name, type, parent_id) VALUES ('Raipur Lok Sabha', 'lok_sabha', ?);`, [zoneId]);
      lokSabhaId = insertId;
    } else {
      lokSabhaId = lokSabhaRows[0].id;
    }

    const [distRows] = await connection.query(`SELECT id FROM locations WHERE name = 'Raipur City District' AND type='district'`);
    let distId;
    if (distRows.length === 0) {
      const [{ insertId }] = await connection.query(`INSERT INTO locations (name, type, parent_id) VALUES ('Raipur City District', 'district', ?);`, [lokSabhaId]);
      distId = insertId;
    } else {
      distId = distRows[0].id;
    }

    // Call statuses table
    console.log('Creating call_statuses table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS call_statuses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE
      );
    `);
    // Seed status values
    const statuses = ['Phone Picked', 'Not Picked', 'Wrong Number', 'Rudely Behaved'];
    for (const s of statuses) {
      await connection.query(`INSERT IGNORE INTO call_statuses (name) VALUES (?)`, [s]);
    }

    // Calls table
    console.log('Creating calls table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id INT AUTO_INCREMENT PRIMARY KEY,
        destination VARCHAR(255),
        person_name VARCHAR(255) NOT NULL,
        address VARCHAR(255),
        phone_number VARCHAR(50) NOT NULL,
        zone_id INT,
        lok_sabha_id INT,
        district_id INT,
        assembly_id INT,
        ward_id INT,
        polling_station_id INT,
        booth_id INT,
        status_id INT NOT NULL,
        remarks TEXT,
        user_id INT NOT NULL,
        called_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (zone_id) REFERENCES locations(id) ON DELETE SET NULL,
        FOREIGN KEY (lok_sabha_id) REFERENCES locations(id) ON DELETE SET NULL,
        FOREIGN KEY (district_id) REFERENCES locations(id) ON DELETE SET NULL,
        FOREIGN KEY (status_id) REFERENCES call_statuses(id) ON DELETE RESTRICT
      );
    `);

    // Seed dummy call records
    const [adminUser] = await connection.query(`SELECT id FROM users WHERE username = 'admin'`);
    const adminId = adminUser[0].id;
    
    // Check if calls exist
    const [callsExist] = await connection.query(`SELECT id FROM calls LIMIT 1`);
    if (callsExist.length === 0) {
      console.log('Seeding dummy calls...');
      const dummyCalls = [
        { name: 'Rahul Sharma', phone: '9876543210', status: 1, notes: 'Interested in joining as volunteer' },
        { name: 'Priya Verma', phone: '9876543211', status: 2, notes: 'Did not pick up' },
        { name: 'Amit Singh', phone: '9876543212', status: 1, notes: 'Needs more information about policies' },
        { name: 'Neha Gupta', phone: '9876543213', status: 3, notes: 'Invalid number' },
        { name: 'Sanjay Kumar', phone: '9876543214', status: 4, notes: 'Asked not to call again' },
        { name: 'Vikram Patel', phone: '9876543215', status: 1, notes: 'Very positive response' },
      ];

      for (const call of dummyCalls) {
        await connection.query(
          `INSERT INTO calls (person_name, phone_number, zone_id, lok_sabha_id, district_id, status_id, remarks, user_id) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          [call.name, call.phone, zoneId, lokSabhaId, distId, call.status, call.notes, adminId]
        );
      }
    }

    console.log('Database initialization and dummy data seeding completed.');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  } finally {
    await connection.end();
  }
}

initDb();
