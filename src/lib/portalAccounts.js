import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { setUserPages } from "@/lib/pageAccess";

// Eligibility is driven by the Designation Master LEVEL — everyone holding a
// designation up to Vidhansabha (Assembly). Block, Zone and anything literally
// named "member" are excluded. Nothing is hard-coded by designation name.
export const PORTAL_LEVELS = ["state", "lok_sabha", "district", "assembly"];
// A portal account is "managed" and gets EXACTLY these pages (role is secondary):
// its Dashboard, Announcements, and the Worker Approval (pending contacts) queue.
export const PORTAL_PAGES = ["portal_home", "portal_announcements", "pending_contacts"];

let _ensured = false;
export async function ensurePortalSchema() {
  if (_ensured) return;
  try {
    // Link each provisioned account to the contact it came from, so re-running the
    // provisioning never creates a second account for the same person.
    if (!(await query("SHOW COLUMNS FROM users LIKE 'contact_id'")).length) {
      try { await query("ALTER TABLE users ADD COLUMN contact_id INT NULL"); }
      catch (e) { if (!/duplicate column/i.test(e?.message || "")) throw e; }
    }
    await query(
      `CREATE TABLE IF NOT EXISTS announcements (
         id INT AUTO_INCREMENT PRIMARY KEY,
         title VARCHAR(200) NOT NULL,
         body TEXT NULL,
         created_by INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    _ensured = true;
  } catch (e) {
    console.error("[portal] ensurePortalSchema:", e?.message || e);
  }
}

// The User ID rule (spec): first 2 LETTERS of the name (uppercase, spaces/specials
// stripped, Unicode-aware for Hindi) + last 6 DIGITS of the phone. Returns null when
// the name has < 2 letters or the phone has < 6 digits (caller reports it, never a
// random id).
export function portalUserId(name, phone) {
  const letters = String(name || "").match(/\p{L}/gu) || [];
  const digits = String(phone || "").replace(/\D/g, "");
  if (letters.length < 2 || digits.length < 6) return null;
  return letters.slice(0, 2).join("").toUpperCase() + digits.slice(-6);
}

// Every eligible designation-holder (one row per contact), with their highest-level
// designations and whether they already have a provisioned account.
export async function listEligiblePeople() {
  await ensurePortalSchema();
  const ph = PORTAL_LEVELS.map(() => "?").join(",");
  return query(
    `SELECT c.id AS contact_id, c.person_name, c.phone_number,
            c.zone_id, c.lok_sabha_id, c.district_id, c.assembly_id,
            (SELECT GROUP_CONCAT(DISTINCT d2.name ORDER BY (d2.sort_order IS NULL), d2.sort_order, d2.name SEPARATOR ', ')
               FROM contact_designations cd2 JOIN designations d2 ON d2.id = cd2.designation_id
              WHERE cd2.contact_id = c.id AND d2.level IN (${ph}) AND d2.name NOT LIKE '%member%') AS designations,
            (SELECT u.username FROM users u WHERE u.contact_id = c.id LIMIT 1) AS existing_username
       FROM contacts c
       JOIN contact_designations cd ON cd.contact_id = c.id
       JOIN designations d ON d.id = cd.designation_id
      WHERE d.level IN (${ph}) AND d.name NOT LIKE '%member%'
        AND NULLIF(TRIM(c.person_name), '') IS NOT NULL
        AND NULLIF(TRIM(c.phone_number), '') IS NOT NULL
      GROUP BY c.id, c.person_name, c.phone_number, c.zone_id, c.lok_sabha_id, c.district_id, c.assembly_id
      ORDER BY c.person_name ASC
      LIMIT 2000`,
    [...PORTAL_LEVELS, ...PORTAL_LEVELS]
  );
}

// Create login accounts for eligible people who don't have one yet. Idempotent and
// safe: an existing account (linked by contact_id) is never overwritten; usernames
// are unique with a deterministic numeric suffix on collision; the mapped role is
// non-admin ('worker') with scope set from the person's own location and EXACTLY the
// portal pages granted. Returns each result incl. the generated User ID.
export async function provisionPortalAccounts(session) {
  await ensurePortalSchema();
  const people = await listEligiblePeople();
  const created = [];
  const skipped = [];
  for (const p of people) {
    if (p.existing_username) {
      skipped.push({ contact_id: p.contact_id, name: p.person_name, username: p.existing_username, reason: "Already has an account" });
      continue;
    }
    const base = portalUserId(p.person_name, p.phone_number);
    if (!base) {
      skipped.push({ contact_id: p.contact_id, name: p.person_name, reason: "Name/phone too short to generate a User ID" });
      continue;
    }
    // Collision-safe: BASE, BASE1, BASE2 … so two people with the same User ID never
    // overwrite each other, and the final id is reported to the admin.
    let username = base, n = 1;
    // eslint-disable-next-line no-await-in-loop
    while ((await query("SELECT id FROM users WHERE username = ? LIMIT 1", [username])).length) username = `${base}${n++}`;
    const hash = await bcrypt.hash("#", 10); // spec password; never returned in plaintext
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await query(
        `INSERT INTO users (username, password, role, home_district_id, scope_zone_id, scope_lok_sabha_id, scope_assembly_id, contact_id)
         VALUES (?, ?, 'worker', ?, ?, ?, ?, ?)`,
        [username, hash, p.district_id || null, p.zone_id || null, p.lok_sabha_id || null, p.assembly_id || null, p.contact_id]
      );
      // eslint-disable-next-line no-await-in-loop
      await setUserPages(res.insertId, PORTAL_PAGES, session?.user?.id || null);
      created.push({ contact_id: p.contact_id, name: p.person_name, username, designations: p.designations });
    } catch (e) {
      skipped.push({ contact_id: p.contact_id, name: p.person_name, reason: e?.sqlMessage || e?.message || "Insert failed" });
    }
  }
  return { eligible: people.length, created, skipped };
}
