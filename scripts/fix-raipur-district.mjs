import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function fix() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aapadmin',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  });

  try {
    console.log('1. Locating Raipur Lok Sabha...');
    const [[raipurLs]] = await conn.query(`SELECT id FROM locations WHERE type='lok_sabha' AND name='Raipur'`);
    if (!raipurLs) throw new Error('Raipur Lok Sabha not found');
    console.log(`   Raipur LS id = ${raipurLs.id}`);

    console.log('2. Inserting Raipur district under Raipur LS...');
    const [r] = await conn.query(
      `INSERT INTO locations (type, name, parent_id) VALUES ('district', 'Raipur', ?)`,
      [raipurLs.id]
    );
    const raipurDistrictId = r.insertId;
    console.log(`   new Raipur district id = ${raipurDistrictId}`);

    console.log('3. Inserting Raipur Vidhan Sabhas...');
    const vs = ["Raipur City Rural", "Raipur City West", "Raipur City North", "Raipur City South", "Arang", "Abhanpur", "Dharsiwa"];
    for (const v of vs) {
      await conn.query(`INSERT INTO locations (type, name, parent_id) VALUES ('assembly', ?, ?)`, [v, raipurDistrictId]);
    }
    console.log(`   inserted ${vs.length} VS.`);

    console.log('4. Relinking existing seeded calls (those with NULL location but with Raipur-area phone numbers from initial seed)...');
    // The 7 originally-seeded calls had names like "Rahul Sharma" / "Priya Verma" — pinned to Raipur City.
    // Their contacts already point to district NULL after the failed relink. Fix both.
    const seedPhones = ['9876543210','9876543211','9876543212','9876543213','9876543214','9876543215'];
    await conn.query(
      `UPDATE calls SET district_id = ? WHERE phone_number IN (?) AND district_id IS NULL`,
      [raipurDistrictId, seedPhones]
    );
    await conn.query(
      `UPDATE contacts SET district_id = ? WHERE phone_number IN (?) AND district_id IS NULL`,
      [raipurDistrictId, seedPhones]
    );
    // Set riyansh's home district to Raipur so workspace works
    await conn.query(`UPDATE users SET home_district_id = ? WHERE username = 'riyansh.ahlawat'`, [raipurDistrictId]);

    const [[fc]] = await conn.query(`
      SELECT
        (SELECT COUNT(*) FROM locations WHERE type='district') AS districts,
        (SELECT COUNT(*) FROM locations WHERE type='assembly') AS vs
    `);
    console.log('Final:', fc);
    console.log('Done.');
  } catch (err) {
    console.error('Fix failed:', err);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

fix();
