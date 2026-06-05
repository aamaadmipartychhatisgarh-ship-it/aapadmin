import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const username = process.argv[2] || 'supervisor';
const password = process.argv[3] || 'supervisor';

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aapadmin',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

try {
  const [rows] = await connection.query("SELECT id FROM users WHERE username = ?", [username]);
  const hash = await bcrypt.hash(password, 10);
  if (rows.length === 0) {
    await connection.query(
      "INSERT INTO users (username, password, role) VALUES (?, ?, 'supervisor')",
      [username, hash]
    );
    console.log(`Created supervisor "${username}" / "${password}"`);
  } else {
    await connection.query(
      "UPDATE users SET role = 'supervisor', password = ? WHERE username = ?",
      [hash, username]
    );
    console.log(`Updated existing user "${username}" to supervisor (password reset to "${password}")`);
  }
} finally {
  await connection.end();
}
