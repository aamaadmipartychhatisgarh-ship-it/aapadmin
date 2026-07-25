// Adds an optional follow_up_time (TIME) column to calls and contacts, so a
// reminder can carry an exact time alongside follow_up_date. Backward compatible:
// existing reminders keep NULL time (treated as the day's default reminder time).
//
//   node scripts/add-followup-time.mjs   (idempotent)

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "aapadmin",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

async function addTime(table) {
  const [c] = await conn.query(`SHOW COLUMNS FROM ${table} LIKE 'follow_up_time'`);
  if (c.length === 0) {
    await conn.query(`ALTER TABLE ${table} ADD COLUMN follow_up_time TIME NULL AFTER follow_up_date`);
    console.log(`+ added ${table}.follow_up_time`);
  } else {
    console.log(`= ${table}.follow_up_time already present`);
  }
}

try {
  await addTime("calls");
  await addTime("contacts");
  console.log("Done.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
