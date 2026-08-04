// Adds social_posts.publish_status (scheduled/published/failed) — the
// existing approval_status column is an editorial workflow (draft/pending/
// approved/rejected), not a publish-outcome state, so there was previously
// no way to tell a scheduled-but-not-yet-posted entry from a failed one.
// Defaults to 'published' since every existing manually-logged post
// represents something that already happened.
//
//   node scripts/add-social-publish-status.mjs   (idempotent)

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "aapadmin",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

try {
  const [c] = await conn.query("SHOW COLUMNS FROM social_posts LIKE 'publish_status'");
  if (c.length === 0) {
    await conn.query(
      "ALTER TABLE social_posts ADD COLUMN publish_status ENUM('scheduled','published','failed') NOT NULL DEFAULT 'published' AFTER approval_status"
    );
    console.log("+ added social_posts.publish_status");
  } else {
    console.log("= social_posts.publish_status already present");
  }
  console.log("Done.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
