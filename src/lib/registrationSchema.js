import crypto from "crypto";
import { query } from "@/lib/db";

// Schema for the "Voter & Worker Registration" module — the public, link-based
// field-collection drive.
//
// The model is three tables:
//   reg_campaigns  one election drive (Election Name / Assembly or Lok Sabha /
//                  Ward / Year). Every link and every registration belongs to one.
//   reg_workers    a karyakarta who collects registrations, holding their running
//                  attribution. A worker row is created either by an admin or, far
//                  more often, by the worker themselves the first time they submit.
//   reg_people     one registered person (voter, or someone who wants to become a
//                  worker), permanently referencing the worker who added them.
//
// There are two kinds of public link, and the difference is only WHO gets the
// credit — the form itself is identical and never asks:
//   • /join — the GENERAL link, for the public. It opens whichever drive is
//     active, so the same URL is printed and forwarded forever, and closing the
//     drive switches it off. Registrations through it belong to the drive and to
//     no worker (reg_people.worker_id IS NULL).
//   • /r/<worker token> (reg_workers.token) — a link GENERATED for one
//     karyakarta, which they then share themselves. Everyone who registers
//     through it is credited to that karyakarta.
//   • /r/<drive token> (reg_campaigns.public_token) — the general link pinned to
//     one specific drive rather than "whichever is active".
// Attribution therefore comes from the link alone. Nobody types a collector's
// name, so nobody can claim someone else's work by editing a form field.
//
// Only status='active' rows count toward any statistic — the single definition of
// a "successful" registration, so duplicates/rejects never inflate a ranking.
//
// ensureRegistrationSchema() is idempotent (CREATE TABLE IF NOT EXISTS) and
// cached per process, so the hot read/write paths run no DDL.

let ensured = false;

export async function ensureRegistrationSchema() {
  if (ensured) return;
  try {
    // --- Election drive (the form's "Election Details" header) --------------
    await query(
      `CREATE TABLE IF NOT EXISTS reg_campaigns (
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
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    // Installs created before the drive-wide link existed: add the column and
    // give every drive a token, so an older drive becomes shareable too.
    await ensureColumn("reg_campaigns", "public_token", "VARCHAR(64) NULL");
    await ensureIndex("reg_campaigns", "uq_reg_campaign_token", "public_token", true);
    const missing = await query(`SELECT id FROM reg_campaigns WHERE public_token IS NULL OR public_token = ''`);
    for (const row of missing) {
      await query(`UPDATE reg_campaigns SET public_token = ? WHERE id = ?`, [newLinkToken(), row.id]);
    }

    // --- Workers + their unique links --------------------------------------
    // `token` is a 96-bit URL-safe random string, UNIQUE — it can neither be
    // guessed nor enumerated, so a link only reaches the worker it was sent to.
    await query(
      `CREATE TABLE IF NOT EXISTS reg_workers (
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
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // --- Registered people --------------------------------------------------
    // registered_at is the auto "Registration Date + Time" the form shows. It is
    // written server-side in IST (see regNow) and never supplied by the client;
    // the DB default is only a backstop for rows inserted by hand.
    await query(
      `CREATE TABLE IF NOT EXISTS reg_people (
         id INT AUTO_INCREMENT PRIMARY KEY,
         campaign_id INT NOT NULL,
         worker_id INT NULL,
         person_type ENUM('voter','worker') NOT NULL DEFAULT 'voter',
         name VARCHAR(160) NOT NULL,
         mobile VARCHAR(20) NULL,
         address TEXT NULL,
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
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    // Installs created before the general /join link existed have worker_id NOT
    // NULL, which would reject every unattributed public registration. Relax it.
    await ensureNullable("reg_people", "worker_id", "INT NULL");

    ensured = true;
  } catch (e) {
    console.error("[registration] ensure schema:", e?.message || e);
  }
}

// Add a column only if it does not already exist (guarded ALTER).
//
// The existence check does NOT use `SHOW COLUMNS ... LIKE ?`: MariaDB's prepared
// statement protocol rejects a placeholder there, so that form throws, the catch
// swallows it, and the ALTER silently never runs — the column would be missing
// forever on an install that pre-dates it. Listing the columns and filtering in
// JS is placeholder-free and cannot fail that way.
async function ensureColumn(table, column, definition) {
  try {
    const rows = await query(`SHOW COLUMNS FROM \`${table}\``);
    if (!rows.some((r) => r.Field === column)) {
      await query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    }
  } catch (e) {
    console.error(`[registration] ensureColumn ${table}.${column}:`, e?.message || e);
  }
}
// Relax a column to NULL only if it is currently NOT NULL — an idempotent MODIFY
// so a table created by an earlier version accepts the newer, wider values.
async function ensureNullable(table, column, definition) {
  try {
    const rows = await query(`SHOW COLUMNS FROM \`${table}\``);
    const col = rows.find((r) => r.Field === column);
    if (col && col.Null === "NO") {
      await query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${definition}`);
    }
  } catch (e) {
    console.error(`[registration] ensureNullable ${table}.${column}:`, e?.message || e);
  }
}
// Add an index only if it does not already exist (same placeholder caveat).
async function ensureIndex(table, indexName, columns, unique = false) {
  try {
    const rows = await query(`SHOW INDEX FROM \`${table}\``);
    if (!rows.some((r) => r.Key_name === indexName)) {
      await query(`ALTER TABLE \`${table}\` ADD ${unique ? "UNIQUE " : ""}INDEX \`${indexName}\` (${columns})`);
    }
  } catch (e) {
    console.error(`[registration] ensureIndex ${table}.${indexName}:`, e?.message || e);
  }
}

// Only 'active' rows are "successful" registrations — the one consistent
// definition every count in this module uses.
export const SUCCESSFUL_STATUS = "active";
export const PERSON_TYPES = ["voter", "worker"];
export const PERSON_STATUSES = ["active", "duplicate", "rejected"];
export const ELECTION_TYPES = ["assembly", "lok_sabha"];

// A worker's public link token: 96 bits of randomness, URL-safe, short enough to
// forward comfortably on WhatsApp.
export function newLinkToken() {
  return crypto.randomBytes(12).toString("base64url");
}

// Permanent, human-readable worker User ID (RAJU@0042) — first 4 letters of the
// name + '@' + the immutable row id. Derived once, never regenerated, so it stays
// stable even if the display name is later corrected.
export function workerCodeFor(name, id) {
  const letters = String(name || "").replace(/[^A-Za-zऀ-ॿ]/g, "");
  const prefix = (letters.slice(0, 4) || "WRKR").toUpperCase().padEnd(4, "X");
  return `${prefix}@${String(id).padStart(4, "0")}`;
}

// --- One clock for the whole module: India Standard Time --------------------
//
// A drive is ranked on "who added the most TODAY", so the day boundary has to be
// the one the karyakartas live in — not the database server's timezone (UTC on
// Hostinger) and not the Node process's. Left to CURRENT_TIMESTAMP, an entry made
// at 9pm in Raipur is stamped 15:30 UTC of the same day but an entry at 6am is
// stamped the PREVIOUS UTC day, and the daily ranking silently misfiles it.
//
// So both halves of the comparison are pinned to Asia/Kolkata: registrations are
// written with an explicit IST timestamp (see regNow) and the period boundaries
// are computed in IST too. Whatever the server is configured as, a day means the
// same thing at both ends.
const IST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

function istFields(date = new Date()) {
  const p = Object.fromEntries(IST_PARTS.formatToParts(date).map((x) => [x.type, x.value]));
  // hour can come back as "24" at midnight in some runtimes; normalise to "00".
  const hour = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}:${p.second}` };
}

// 'YYYY-MM-DD HH:MM:SS' in IST — the value written to reg_people.registered_at.
export function regNow() {
  const f = istFields();
  return `${f.date} ${f.time}`;
}
// Today's IST calendar date as 'YYYY-MM-DD'.
export function istToday() {
  return istFields().date;
}

// Date-range presets → { from, to } as inclusive 'YYYY-MM-DD' in IST, compared
// against the registration timestamp. Mirrors the membership module's preset
// names so both dashboards mean the same thing by "This Week".
export function resolveRegPeriod(preset, from, to) {
  // Work in a UTC-anchored Date built from the IST calendar date, so adding and
  // subtracting days can never be shifted by a timezone or a DST rule.
  const today = istToday();
  const base = new Date(`${today}T00:00:00Z`);
  const iso = (d) => d.toISOString().slice(0, 10);
  const shift = (days) => { const x = new Date(base); x.setUTCDate(x.getUTCDate() + days); return x; };
  switch (preset) {
    case "today": return { from: today, to: today };
    case "yesterday": { const y = iso(shift(-1)); return { from: y, to: y }; }
    // Weeks run Monday–Sunday, matching how the field teams report.
    case "week": return { from: iso(shift(-((base.getUTCDay() + 6) % 7))), to: today };
    case "month": return { from: `${today.slice(0, 7)}-01`, to: today };
    case "custom": return { from: from || null, to: to || null };
    default: return { from: null, to: null }; // lifetime / campaign total
  }
}

// Indian mobile number → 10 digits, or null when it isn't one. A leading 0 or
// +91 is stripped, so a number pasted in any common form still normalizes.
export function normalizeMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}
