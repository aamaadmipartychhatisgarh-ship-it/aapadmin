import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { setUserPages } from "@/lib/pageAccess";
import { WORKER_DEFAULT_PAGES } from "@/lib/pages";
import { logAudit } from "@/lib/audit";
import { phoneKey, last10Sql } from "@/lib/phone";
import { ensureWingSchema } from "@/lib/wingDesignations";
import { syncContactDesignations, parseDesignationIds } from "@/lib/contactDesignations";

// Eligibility is driven by the Designation Master LEVEL — everyone holding a
// designation up to Vidhansabha (Assembly). Block, Zone and anything literally
// named "member" are excluded. Nothing is hard-coded by designation name.
export const PORTAL_LEVELS = ["state", "lok_sabha", "district", "assembly"];
// Generic rank-and-file "member" designations are excluded, but ONLY when the
// name IS "member" (case-insensitive, trimmed) — a substring `LIKE '%member%'`
// wrongly dropped leadership roles like "Executive Member" / "Member President".
// Centralised so the inner GROUP_CONCAT and the outer WHERE use the identical test.
const NOT_GENERIC_MEMBER = "LOWER(TRIM(%A.name)) <> 'member'";
function notGenericMember(alias) { return NOT_GENERIC_MEMBER.replace("%A", alias); }
// A portal account is "managed" and gets EXACTLY these pages (role is secondary):
// its Dashboard, Announcements and Designation Approval (see WORKER_DEFAULT_PAGES).
export const PORTAL_PAGES = WORKER_DEFAULT_PAGES;

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

// The Member Account DEFAULT PASSWORD (spec):
//   LAST 2 letters of the Name (CAPITAL) + '@' + MIDDLE 4 digits of the Phone + '#'
// Example: Neha + 9876543210 -> "HA@6543#".
// Letters are taken Unicode-aware (so Hindi names work); the phone is normalised to
// its 10-digit number first (country code / separators stripped) and the middle 4
// are the four centre digits. Generated from the ACTUAL saved name + phone at
// creation time; never stored or returned in plaintext (only its bcrypt hash is).
export function portalDefaultPassword(name, phone) {
  const letters = String(name || "").match(/\p{L}/gu) || [];
  const last2 = letters.slice(-2).join("").toUpperCase();
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length >= 10) digits = digits.slice(-10); // normalise to the 10-digit number
  const start = Math.max(0, Math.floor((digits.length - 4) / 2));
  const mid4 = digits.slice(start, start + 4);
  return `${last2}@${mid4}#`;
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
              WHERE cd2.contact_id = c.id AND d2.level IN (${ph}) AND ${notGenericMember("d2")}) AS designations,
            (SELECT u.username FROM users u WHERE u.contact_id = c.id LIMIT 1) AS existing_username
       FROM contacts c
       JOIN contact_designations cd ON cd.contact_id = c.id
       JOIN designations d ON d.id = cd.designation_id
      WHERE d.level IN (${ph}) AND ${notGenericMember("d")}
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
    // insertPortalUser is collision-safe AND retries on a duplicate-username key
    // (so a concurrent provision run can't lose a person to `skipped` — the L2
    // concern), so use it directly rather than an inline check-then-insert.
    try {
      const { username } = await insertPortalUser(base, p, session);
      created.push({ contact_id: p.contact_id, name: p.person_name, username, designations: p.designations });
    } catch (e) {
      skipped.push({ contact_id: p.contact_id, name: p.person_name, reason: e?.sqlMessage || e?.message || "Insert failed" });
    }
  }
  return { eligible: people.length, created, skipped };
}

// The single place a portal login row is written (used by BOTH the bulk
// provisioning above and the one-person creation form below), so the username
// collision rule, the default-password format (portalDefaultPassword), the
// non-admin role, the territory scope and the exact page grants can never drift
// apart.
//
// Collision-safe: BASE, BASE1, BASE2 … so two people with the same User ID never
// overwrite each other; the final id is returned to the admin. The DB's UNIQUE
// username index is the race-safe backstop: a lost race is retried with the next
// suffix instead of touching the existing row.
async function insertPortalUser(base, person, session) {
  // Default password is derived from the person's actual name + phone (spec format:
  // last 2 name letters CAPITAL + '@' + middle 4 phone digits + '#'). Both callers
  // pass person.person_name + person.phone_number. Only the bcrypt hash is stored;
  // the plaintext is never logged or returned.
  const hash = await bcrypt.hash(portalDefaultPassword(person.person_name, person.phone_number), 10);
  let n = 1;
  let username = base;
  while (true) {
    while ((await query("SELECT id FROM users WHERE username = ? LIMIT 1", [username])).length) username = `${base}${n++}`;
    try {
      const res = await query(
        `INSERT INTO users (username, password, role, home_district_id, scope_zone_id, scope_lok_sabha_id, scope_assembly_id, contact_id)
         VALUES (?, ?, 'worker', ?, ?, ?, ?, ?)`,
        [username, hash, person.district_id || null, person.zone_id || null, person.lok_sabha_id || null, person.assembly_id || null, person.contact_id]
      );
      await setUserPages(res.insertId, PORTAL_PAGES, session?.user?.id || null);
      return { user_id: res.insertId, username };
    } catch (e) {
      if (e?.code === "ER_DUP_ENTRY" && /username/i.test(e?.sqlMessage || "")) { username = `${base}${n++}`; continue; }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// One-person creation form ("User Creation / Access Form").
// ---------------------------------------------------------------------------

// Designations an admin may pick in the form: eligible LEVELS only (State, Lok
// Sabha, District, Assembly). Block/Zone-level rows, rows with no level, disabled
// rows and anything named "member" never appear — the same rule listEligiblePeople
// uses, so the form and the bulk provisioning can never disagree.
export async function listEligibleDesignations() {
  await ensureWingSchema(); // adds level / enabled / rank columns on a current schema
  // Feature-detect the optional columns (same approach as /api/designations) so an
  // older schema degrades to "nothing eligible" instead of a 500.
  const cols = new Set((await query("SHOW COLUMNS FROM designations")).map((c) => c.Field));
  if (!cols.has("level")) return [];
  const ph = PORTAL_LEVELS.map(() => "?").join(",");
  const order = [
    cols.has("rank") ? "(`rank` IS NULL), `rank` ASC" : null,
    cols.has("sort_order") ? "(sort_order IS NULL), sort_order ASC" : null,
    "name ASC", "id ASC",
  ].filter(Boolean).join(", ");
  return query(
    `SELECT id, name, level, ${cols.has("wing") ? "wing" : "NULL AS wing"}
       FROM designations
      WHERE level IN (${ph}) AND name NOT LIKE '%member%'${cols.has("enabled") ? " AND enabled = 1" : ""}
      ORDER BY ${order}`,
    PORTAL_LEVELS
  );
}

// Thrown for admin-facing validation problems; the route maps `status` to HTTP.
export class PortalAccountError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

// Create ONE member account from the form. Flow:
//   1. validate name / phone / designation (all server-side, never trusting the UI);
//   2. reuse the person's existing contact record (matched on mobile) or create one;
//   3. refuse if that contact already owns a login — an existing user's credentials
//      are NEVER overwritten (admin is told the existing User ID instead);
//   4. write the user row via insertPortalUser (auto User ID, default password in
//      the portalDefaultPassword format, role 'worker', territory scope, EXACTLY
//      the three portal pages).
// Returns { user_id, username, contact_id, reused_contact } — no password, ever.
export async function createPortalAccount(input, session) {
  await ensurePortalSchema();
  const name = String(input?.name ?? "").trim().replace(/\s+/g, " ");
  const phoneRaw = String(input?.phone ?? "").trim();
  const digits = phoneRaw.replace(/\D/g, "");
  if (!name) throw new PortalAccountError("Name is required.");
  if ((name.match(/\p{L}/gu) || []).length < 2) throw new PortalAccountError("Name must contain at least 2 letters (needed to generate the User ID).");
  if (!phoneRaw) throw new PortalAccountError("Phone number is required.");
  if (digits.length < 10 || digits.length > 13) throw new PortalAccountError("Enter a valid mobile number (10 digits).");

  // Designation: at least one, every one must be on the eligible list. Member and
  // Block level ids are rejected here even if a client sends them.
  const designationIds = parseDesignationIds(input?.designation_ids ?? (input?.designation_id ? [input.designation_id] : []));
  if (!designationIds.length) throw new PortalAccountError("Select the person's designation.");
  const eligible = await listEligibleDesignations();
  const eligibleIds = new Set(eligible.map((d) => d.id));
  const bad = designationIds.filter((id) => !eligibleIds.has(id));
  if (bad.length) throw new PortalAccountError("Only State, Lok Sabha, District and Assembly level designations are allowed for member accounts.");

  const base = portalUserId(name, phoneRaw);
  if (!base) throw new PortalAccountError("Could not generate a User ID from this name and phone.");

  const geo = {
    zone_id: Number(input?.zone_id) || null,
    lok_sabha_id: Number(input?.lok_sabha_id) || null,
    district_id: Number(input?.district_id) || null,
    assembly_id: Number(input?.assembly_id) || null,
  };

  // 2. Existing contact for this mobile (exact string, or same last-10 digits)?
  const key = phoneKey(phoneRaw);
  const found = await query(
    `SELECT id, person_name, zone_id, lok_sabha_id, district_id, assembly_id
       FROM contacts WHERE phone_number = ? OR ${last10Sql("phone_number")} = ? LIMIT 1`,
    [phoneRaw, key]
  );
  let contactId;
  let reusedContact = false;
  if (found.length) {
    contactId = found[0].id;
    reusedContact = true;
    // 3. Never overwrite an existing login.
    const owner = await query("SELECT username FROM users WHERE contact_id = ? LIMIT 1", [contactId]);
    if (owner.length) {
      throw new PortalAccountError(`This person already has a login account (User ID ${owner[0].username}).`, 409, { username: owner[0].username, contact_id: contactId });
    }
    // Keep the contact's own data; only ADD the chosen designation(s) and fill in
    // territory fields that are still blank.
    for (const d of designationIds) {
      await query("INSERT IGNORE INTO contact_designations (contact_id, designation_id) VALUES (?, ?)", [contactId, d]);
    }
    const fill = Object.entries(geo).filter(([k, v]) => v && !found[0][k]);
    if (fill.length) {
      await query(`UPDATE contacts SET ${fill.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [...fill.map(([, v]) => v), contactId]);
    }
    for (const k of Object.keys(geo)) geo[k] = found[0][k] || geo[k];
  } else {
    const cols = new Set((await query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'`
    )).map((r) => r.name));
    const desired = { person_name: name, phone_number: phoneRaw, designation_id: designationIds[0], ...geo };
    const names = Object.keys(desired).filter((k) => cols.has(k));
    const res = await query(
      `INSERT INTO contacts (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
      names.map((k) => desired[k])
    );
    contactId = res.insertId;
    await syncContactDesignations(contactId, designationIds);
  }

  // 4. The login row. Pass the actual name + phone so the default password is
  // generated from them (spec format), not a fixed value.
  const { user_id, username } = await insertPortalUser(base, { contact_id: contactId, person_name: name, phone_number: phoneRaw, ...geo }, session);
  await logAudit(session, {
    action: "user.create",
    entityType: "user",
    entityId: user_id,
    details: { username, role: "worker", pages: PORTAL_PAGES, source: "member_account_form", contact_id: contactId, designation_ids: designationIds },
  });
  return { user_id, username, contact_id: contactId, reused_contact: reusedContact, name };
}

// ---------------------------------------------------------------------------
// Member Accounts = the ONLY place Worker (role='worker') accounts are listed and
// managed. These rows are the same `users` records the portal engine creates,
// linked to `contacts` by users.contact_id — no second account system.
// ---------------------------------------------------------------------------

// Every worker account (including legacy ones with no linked contact), with the
// linked contact's details, designations and assembly/district names.
export async function listWorkerAccounts() {
  await ensurePortalSchema();
  const rows = await query(
    `SELECT u.id, u.username, u.is_active, u.created_at, u.last_seen_at, u.contact_id,
            u.home_district_id, u.scope_zone_id, u.scope_lok_sabha_id, u.scope_assembly_id,
            c.person_name, c.phone_number,
            (SELECT GROUP_CONCAT(DISTINCT d.name ORDER BY (d.sort_order IS NULL), d.sort_order, d.name SEPARATOR ', ')
               FROM contact_designations cd JOIN designations d ON d.id = cd.designation_id
              WHERE cd.contact_id = c.id) AS designations,
            la.name AS assembly_name, ld.name AS district_name
       FROM users u
       LEFT JOIN contacts c ON c.id = u.contact_id
       LEFT JOIN locations la ON la.id = COALESCE(u.scope_assembly_id, c.assembly_id)
       LEFT JOIN locations ld ON ld.id = COALESCE(u.home_district_id, c.district_id)
      WHERE u.role = 'worker'
      ORDER BY COALESCE(c.person_name, u.username) ASC
      LIMIT 5000`
  );
  // Report (never auto-merge/delete) worker accounts that share a contact or phone.
  const byKey = new Map();
  for (const r of rows) {
    const keys = [];
    if (r.contact_id) keys.push(`c:${r.contact_id}`);
    const pk = phoneKey(r.phone_number);
    if (pk) keys.push(`p:${pk}`);
    for (const k of keys) { if (!byKey.has(k)) byKey.set(k, new Set()); byKey.get(k).add(r.id); }
  }
  const dup = new Set();
  for (const ids of byKey.values()) if (ids.size > 1) ids.forEach((i) => dup.add(i));
  return rows.map((r) => ({ ...r, is_active: r.is_active === 0 ? 0 : 1, possible_duplicate: dup.has(r.id) }));
}

// Update an existing worker account in place: contact name/phone, status and
// territory. Only users with role='worker' are touched; User ID, password,
// registration links and page grants are preserved.
export async function updateWorkerAccount(id, input, session) {
  await ensurePortalSchema();
  const [u] = await query("SELECT id, username, role, contact_id FROM users WHERE id = ?", [id]);
  if (!u || u.role !== "worker") throw new PortalAccountError("Worker account not found.", 404);

  const sets = [], vals = [];
  const nullable = (v) => (v === "" || v == null ? null : Number(v));
  if ("is_active" in input) { sets.push("is_active = ?"); vals.push(input.is_active ? 1 : 0); }
  for (const [k, col] of [["district_id", "home_district_id"], ["zone_id", "scope_zone_id"], ["lok_sabha_id", "scope_lok_sabha_id"], ["assembly_id", "scope_assembly_id"]]) {
    if (k in input) { sets.push(`${col} = ?`); vals.push(nullable(input[k])); }
  }
  if (sets.length) await query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);

  if (u.contact_id) {
    const cs = [], cv = [];
    if (typeof input.name === "string" && input.name.trim()) { cs.push("person_name = ?"); cv.push(input.name.trim()); }
    if (typeof input.phone === "string" && input.phone.trim()) {
      const key = phoneKey(input.phone);
      if (!key) throw new PortalAccountError("Enter a valid mobile number.", 400);
      const clash = await query(`SELECT id FROM contacts WHERE ${last10Sql("phone_number")} = ? AND id <> ? LIMIT 1`, [key, u.contact_id]);
      if (clash.length) throw new PortalAccountError("Another contact already uses this mobile number.", 409);
      cs.push("phone_number = ?"); cv.push(input.phone.trim());
    }
    if (cs.length) await query(`UPDATE contacts SET ${cs.join(", ")} WHERE id = ?`, [...cv, u.contact_id]);
  }
  logAudit(session, { action: "portal.worker.update", entityType: "user", entityId: Number(id), details: { username: u.username, fields: Object.keys(input) } });
  return { ok: true };
}
