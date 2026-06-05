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
    console.log('1. Creating contacts table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        person_name VARCHAR(255) NOT NULL,
        phone_number VARCHAR(50) NOT NULL,
        address TEXT,
        designation_id INT NULL,
        zone_id INT NULL,
        lok_sabha_id INT NULL,
        district_id INT NULL,
        assembly_id INT NULL,
        ward_id INT NULL,
        booth_id INT NULL,
        assigned_to_user_id INT NULL,
        is_completed TINYINT(1) DEFAULT 0,
        locked_by_user_id INT NULL,
        locked_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_phone (phone_number),
        INDEX idx_assigned (assigned_to_user_id, is_completed),
        INDEX idx_district (district_id, is_completed),
        FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (locked_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (district_id) REFERENCES locations(id) ON DELETE SET NULL,
        FOREIGN KEY (ward_id) REFERENCES locations(id) ON DELETE SET NULL,
        FOREIGN KEY (booth_id) REFERENCES locations(id) ON DELETE SET NULL
      );
    `);

    console.log('2. Adding users.home_district_id...');
    const [hd] = await connection.query(`SHOW COLUMNS FROM users LIKE 'home_district_id'`);
    if (hd.length === 0) {
      await connection.query(`ALTER TABLE users ADD COLUMN home_district_id INT NULL`);
      await connection.query(`ALTER TABLE users ADD FOREIGN KEY (home_district_id) REFERENCES locations(id) ON DELETE SET NULL`);
    }

    console.log('3. Adding calls.contact_id...');
    const [cc] = await connection.query(`SHOW COLUMNS FROM calls LIKE 'contact_id'`);
    if (cc.length === 0) {
      await connection.query(`ALTER TABLE calls ADD COLUMN contact_id INT NULL`);
      await connection.query(`ALTER TABLE calls ADD FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL`);
    }

    console.log('4. Backfilling contacts from existing calls (dedupe by phone)...');
    const [existing] = await connection.query(`SELECT COUNT(*) AS n FROM contacts`);
    if (existing[0].n === 0) {
      // Pick the most recent call per phone to define the contact's location/name
      await connection.query(`
        INSERT INTO contacts (person_name, phone_number, address, designation_id, zone_id, lok_sabha_id, district_id, assembly_id, ward_id, booth_id, is_completed)
        SELECT c.person_name, c.phone_number, c.address, c.designation_id,
               c.zone_id, c.lok_sabha_id, c.district_id, c.assembly_id, c.ward_id, c.booth_id,
               0
          FROM calls c
          INNER JOIN (
            SELECT phone_number, MAX(id) AS latest_id FROM calls GROUP BY phone_number
          ) latest ON latest.latest_id = c.id
      `);
      const [inserted] = await connection.query(`SELECT COUNT(*) AS n FROM contacts`);
      console.log(`   + backfilled ${inserted[0].n} contacts`);

      // Link existing calls to their contact
      await connection.query(`
        UPDATE calls c
          JOIN contacts ct ON ct.phone_number = c.phone_number
          SET c.contact_id = ct.id
      `);

      // Mark contacts as completed if they have any "Phone Picked" call
      await connection.query(`
        UPDATE contacts ct
          JOIN calls c ON c.contact_id = ct.id
          JOIN call_statuses cs ON cs.id = c.status_id
          SET ct.is_completed = 1
          WHERE cs.name = 'Phone Picked'
      `);
    } else {
      console.log('   = contacts already populated, skipping backfill');
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
