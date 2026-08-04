// Expands social_pages.platform to cover Twitter/X, LinkedIn and Telegram
// (facebook/instagram/whatsapp/youtube already existed) — additive only,
// existing values/rows are unaffected. Adding a further platform later is
// just one more enum value here plus one more entry in the PLATFORM
// constant in src/app/dashboard/social-management/page.js — no other
// redesign needed.
//
//   node scripts/expand-social-platform-enum.mjs   (idempotent)

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "aapadmin",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

const TARGET = ["facebook", "instagram", "whatsapp", "youtube", "twitter", "linkedin", "telegram"];

try {
  const [[col]] = await conn.query("SHOW COLUMNS FROM social_pages LIKE 'platform'");
  const current = [...col.Type.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const missing = TARGET.filter((v) => !current.includes(v));
  if (missing.length > 0) {
    const enumList = TARGET.map((v) => `'${v}'`).join(",");
    await conn.query(`ALTER TABLE social_pages MODIFY platform ENUM(${enumList}) NOT NULL`);
    console.log(`+ expanded social_pages.platform with: ${missing.join(", ")}`);
  } else {
    console.log("= social_pages.platform already covers all target values");
  }
  console.log("Done.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
