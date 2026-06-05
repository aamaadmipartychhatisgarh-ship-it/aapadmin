import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function updateDb() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  });

  const dbName = process.env.DB_NAME || 'aapadmin';

  try {
    await connection.query(`USE \`${dbName}\`;`);

    console.log('Creating locations table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS locations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type ENUM('zone', 'lok_sabha', 'district', 'assembly', 'ward', 'polling_station', 'booth') NOT NULL,
        name VARCHAR(255) NOT NULL,
        parent_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES locations(id) ON DELETE CASCADE
      );
    `);

    console.log('Creating call_statuses table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS call_statuses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE
      );
    `);

    // Seed default call statuses
    console.log('Seeding default call statuses...');
    const defaultStatuses = ['Phone Picked', 'Not Picked', 'Wrong Number', 'Rudely Behaved'];
    for (const status of defaultStatuses) {
      await connection.query(
        `INSERT IGNORE INTO call_statuses (name) VALUES (?)`,
        [status]
      );
    }

    console.log('Creating calls table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id INT AUTO_INCREMENT PRIMARY KEY,
        destination VARCHAR(255),
        person_name VARCHAR(255) NOT NULL,
        address TEXT,
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
        FOREIGN KEY (zone_id) REFERENCES locations(id) ON DELETE SET NULL,
        FOREIGN KEY (lok_sabha_id) REFERENCES locations(id) ON DELETE SET NULL,
        FOREIGN KEY (district_id) REFERENCES locations(id) ON DELETE SET NULL,
        FOREIGN KEY (assembly_id) REFERENCES locations(id) ON DELETE SET NULL,
        FOREIGN KEY (ward_id) REFERENCES locations(id) ON DELETE SET NULL,
        FOREIGN KEY (polling_station_id) REFERENCES locations(id) ON DELETE SET NULL,
        FOREIGN KEY (booth_id) REFERENCES locations(id) ON DELETE SET NULL,
        FOREIGN KEY (status_id) REFERENCES call_statuses(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);

    console.log('Seeding dummy location data (Zones and Districts) for testing...');
    // Only insert if no locations exist
    const [existingLocations] = await connection.query(`SELECT COUNT(*) as count FROM locations`);
    if (existingLocations[0].count === 0) {
      // Insert Zones
      const [resZone1] = await connection.query(`INSERT INTO locations (type, name) VALUES ('zone', 'Raipur Zone')`);
      const [resZone2] = await connection.query(`INSERT INTO locations (type, name) VALUES ('zone', 'Bilaspur Zone')`);
      
      const raipurZoneId = resZone1.insertId;
      const bilaspurZoneId = resZone2.insertId;

      // Insert Lok Sabhas
      const [resLs1] = await connection.query(`INSERT INTO locations (type, name, parent_id) VALUES ('lok_sabha', 'Raipur LS', ?)`, [raipurZoneId]);
      const [resLs2] = await connection.query(`INSERT INTO locations (type, name, parent_id) VALUES ('lok_sabha', 'Bilaspur LS', ?)`, [bilaspurZoneId]);

      // Insert Districts
      await connection.query(`INSERT INTO locations (type, name, parent_id) VALUES ('district', 'Raipur District', ?)`, [resLs1.insertId]);
      await connection.query(`INSERT INTO locations (type, name, parent_id) VALUES ('district', 'Bilaspur District', ?)`, [resLs2.insertId]);
      
      console.log('Dummy locations created.');
    }

    console.log('Database update completed successfully.');
  } catch (error) {
    console.error('Failed to update database:', error);
  } finally {
    await connection.end();
  }
}

updateDb();
