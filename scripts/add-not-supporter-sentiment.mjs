// Adds a "not_supporter" value to the calls.sentiment ENUM so callers can record
// that a person who picked up clearly stated they are not a supporter.
//
// Run:  node scripts/add-not-supporter-sentiment.mjs   (uses .env.local)
// Idempotent: re-running is a no-op if the value already exists.

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const c = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "aapadmin",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

try {
  const [[col]] = await c.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'calls' AND COLUMN_NAME = 'sentiment'`,
    [process.env.DB_NAME || "aapadmin"]
  );
  if (!col) {
    console.log("! calls.sentiment column not found — nothing to do");
  } else if (col.COLUMN_TYPE.includes("not_supporter")) {
    console.log("= calls.sentiment already includes 'not_supporter'");
  } else {
    await c.query(
      `ALTER TABLE calls MODIFY COLUMN sentiment
         ENUM('positive','negative','neutral','supporter','opponent','not_supporter') NULL`
    );
    console.log("+ added 'not_supporter' to calls.sentiment ENUM");
  }
  console.log("Done.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await c.end();
}
