// Voter & Worker Registration — provision the module's three tables.
//
//   node scripts/add-registration-schema.mjs                  (uses .env.local)
//   node scripts/add-registration-schema.mjs --env .env.local.production-backup
//
// The app also creates all of this lazily on the first request (see
// src/lib/registrationSchema.js — ensureRegistrationSchema); this script just
// lets you provision it up front, e.g. against production before a deploy so the
// first public form submission is not the thing running DDL.
//
// Idempotent: CREATE TABLE IF NOT EXISTS plus guarded ALTERs, so it is safe to
// re-run, and safe on a database that already has the tables from an older
// version of the module.
//
// Kept deliberately in step with src/lib/registrationSchema.js. If you change the
// schema there, change it here too.

import mysql from "mysql2/promise";
import crypto from "crypto";
import dotenv from "dotenv";
import path from "path";

const envArg = process.argv.indexOf("--env");
const envFile = envArg > -1 ? process.argv[envArg + 1] : ".env.local";
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "aapadmin",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

// The existence checks avoid `SHOW COLUMNS ... LIKE ?` — MariaDB rejects a
// placeholder there, so that form throws and the guarded ALTER never runs.
async function columns(table) {
  const [rows] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
  return rows;
}
async function ensureColumn(table, column, definition) {
  const cols = await columns(table);
  if (!cols.some((c) => c.Field === column)) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`+ ${table}.${column}`);
  }
}
async function ensureIndex(table, indexName, cols, unique = false) {
  const [rows] = await conn.query(`SHOW INDEX FROM \`${table}\``);
  if (!rows.some((r) => r.Key_name === indexName)) {
    await conn.query(`ALTER TABLE \`${table}\` ADD ${unique ? "UNIQUE " : ""}INDEX \`${indexName}\` (${cols})`);
    console.log(`+ ${table} index ${indexName}`);
  }
}
async function ensureNullable(table, column, definition) {
  const cols = await columns(table);
  const col = cols.find((c) => c.Field === column);
  if (col && col.Null === "NO") {
    await conn.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${definition}`);
    console.log(`~ ${table}.${column} relaxed to NULL`);
  }
}

try {
  console.log(`Connecting to ${process.env.DB_NAME} at ${process.env.DB_HOST} (env: ${envFile})`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS reg_campaigns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      election_type ENUM('assembly','lok_sabha') NOT NULL DEFAULT 'assembly',
      constituency VARCHAR(160) NULL,
      constituency_id INT NULL,
      ward_number VARCHAR(60) NULL,
      election_year VARCHAR(9) NULL,
      public_token VARCHAR(64) NULL,
      status ENUM('active','closed') NOT NULL DEFAULT 'active',
      created_by INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_reg_campaign_token (public_token),
      KEY idx_reg_campaign_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureColumn("reg_campaigns", "public_token", "VARCHAR(64) NULL");
  await ensureIndex("reg_campaigns", "uq_reg_campaign_token", "public_token", true);
  const [needToken] = await conn.query(
    `SELECT id FROM reg_campaigns WHERE public_token IS NULL OR public_token = ''`
  );
  for (const row of needToken) {
    await conn.query(`UPDATE reg_campaigns SET public_token = ? WHERE id = ?`,
      [crypto.randomBytes(12).toString("base64url"), row.id]);
  }
  console.log("= reg_campaigns");

  await conn.query(`
    CREATE TABLE IF NOT EXISTS reg_workers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      campaign_id INT NOT NULL,
      name VARCHAR(160) NOT NULL,
      mobile VARCHAR(20) NULL,
      worker_code VARCHAR(24) NULL,
      token VARCHAR(64) NOT NULL,
      ward_number VARCHAR(60) NULL,
      area_booth VARCHAR(160) NULL,
      status ENUM('active','disabled') NOT NULL DEFAULT 'active',
      created_by INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_reg_worker_token (token),
      UNIQUE KEY uq_reg_worker_campaign_mobile (campaign_id, mobile),
      KEY idx_reg_worker_campaign (campaign_id),
      KEY idx_reg_worker_status (status),
      KEY idx_reg_worker_mobile (mobile),
      KEY idx_reg_worker_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("= reg_workers");

  await conn.query(`
    CREATE TABLE IF NOT EXISTS reg_people (
      id INT AUTO_INCREMENT PRIMARY KEY,
      campaign_id INT NOT NULL,
      worker_id INT NULL,
      person_type ENUM('voter','worker') NOT NULL DEFAULT 'voter',
      name VARCHAR(160) NOT NULL,
      mobile VARCHAR(20) NULL,
      address TEXT NULL,
      assembly_id INT NULL,
      assembly_name VARCHAR(160) NULL,
      ward_number VARCHAR(60) NULL,
      area_booth VARCHAR(160) NULL,
      wants_worker TINYINT NOT NULL DEFAULT 0,
      worker_role VARCHAR(160) NULL,
      status ENUM('active','duplicate','rejected') NOT NULL DEFAULT 'active',
      source_ip VARCHAR(64) NULL,
      registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_reg_people_campaign (campaign_id),
      KEY idx_reg_people_worker (worker_id),
      KEY idx_reg_people_type (person_type),
      KEY idx_reg_people_ward (ward_number),
      KEY idx_reg_people_registered (registered_at),
      KEY idx_reg_people_status (status),
      KEY idx_reg_people_mobile (mobile)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // A registration through the general /join link belongs to no karyakarta.
  await ensureNullable("reg_people", "worker_id", "INT NULL");
  await ensureColumn("reg_people", "assembly_id", "INT NULL");
  await ensureColumn("reg_people", "assembly_name", "VARCHAR(160) NULL");
  await ensureIndex("reg_people", "idx_reg_people_assembly", "assembly_id");
  console.log("= reg_people");

  const [[counts]] = await conn.query(`
    SELECT (SELECT COUNT(*) FROM reg_campaigns) AS drives,
           (SELECT COUNT(*) FROM reg_workers)   AS worker_links,
           (SELECT COUNT(*) FROM reg_people)    AS registrations
  `);
  console.log(`Done. drives=${counts.drives} worker_links=${counts.worker_links} registrations=${counts.registrations}`);
  console.log("The public form is at /join once a drive is created and set active.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
