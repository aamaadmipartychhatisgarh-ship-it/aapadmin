// Per-user sidebar layout preferences (order, pins, favourites). Stored as a
// single JSON blob keyed by the stable menu href, so it survives menu additions/
// removals and never depends on array indexes. One row per user; role defaults
// apply when no row exists. Idempotent.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const c = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});
try {
  await c.query(
    `CREATE TABLE IF NOT EXISTS sidebar_preferences (
       user_id INT NOT NULL PRIMARY KEY,
       prefs LONGTEXT NULL,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     )`
  );
  console.log("sidebar_preferences table ready.");
} finally {
  await c.end();
}
