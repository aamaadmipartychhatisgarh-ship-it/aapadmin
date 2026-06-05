import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const districts = [
  "Balod", "Balodabazar-Bhatapara", "Balrampur-Ramanujganj", "Bastar", "Bemetara",
  "Bijapur", "Bilaspur", "Dakshin Bastar Dantewada", "Dhamtari", "Durg", "Gariyaband",
  "Gaurela-Pendra-Marwahi", "Janjgir-Champa", "Jashpur", "Kabeerdham",
  "Khairagarh-Chhuikhadan-Gandai", "Kondagaon", "Korba", "Korea", "Mahasamund",
  "Manendragarh-Chirmiri-Bharatpur(M C B)", "Mohla-Manpur-Ambagarh Chouki",
  "Mungeli", "Narayanpur", "Raigarh", "Raipur", "Rajnandgaon", "Sakti",
  "Sarangarh-Bilaigarh", "Sukma", "Surajpur", "Surguja", "Uttar Bastar Kanker"
];

async function seedDistricts() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aapadmin',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  });

  try {
    console.log('Seeding 33 Chhattisgarh Districts...');
    let added = 0;
    
    for (const d of districts) {
      // Check if it exists
      const [rows] = await connection.query(`SELECT id FROM locations WHERE name = ? AND type = 'district'`, [d]);
      if (rows.length === 0) {
        await connection.query(`INSERT INTO locations (name, type) VALUES (?, 'district')`, [d]);
        added++;
        console.log(`Added: ${d}`);
      } else {
        console.log(`Skipped (already exists): ${d}`);
      }
    }
    
    console.log(`\nDone! Added ${added} new districts.`);
  } catch (error) {
    console.error('Error seeding districts:', error);
  } finally {
    await connection.end();
  }
}

seedDistricts();
