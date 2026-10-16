import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { portalDefaultPassword } from "@/lib/portalAccounts";

// Worker (Member Account) logins created BEFORE the default password became
// "<last 2 name letters CAPS>@<middle 4 phone digits>#" (commit of 2026-10-08) were
// stored with the old fixed default "#". Admins/members are now told the new
// format, so those accounts rejected the documented password ("Invalid
// credentials"). One time, any worker whose stored hash STILL verifies as the old
// default "#" (i.e. nobody ever changed it) is moved to the documented default for
// their linked contact's name + phone. This only ever REPLACES the weak shared
// default with the per-person default: accounts with any other password are never
// touched, the password is only ever stored as a bcrypt hash, and nothing is
// accepted that wasn't before.

const MARKER = "worker_default_password_v1";
let _promise = null;

export function ensureWorkerDefaultPasswords() {
  if (!_promise) _promise = run().catch((e) => { console.error("[workerCredentials]", e?.message || e); _promise = null; });
  return _promise;
}

async function run() {
  await query(
    `CREATE TABLE IF NOT EXISTS app_migrations (
       name VARCHAR(128) PRIMARY KEY,
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  if ((await query("SELECT 1 FROM app_migrations WHERE name = ? LIMIT 1", [MARKER])).length) return;
  const rows = await query(
    `SELECT u.id, u.password, c.person_name, c.phone_number
       FROM users u JOIN contacts c ON c.id = u.contact_id
      WHERE u.role = 'worker' AND u.password IS NOT NULL`
  );
  let upgraded = 0;
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await bcrypt.compare("#", r.password).catch(() => false))) continue;
    const pw = portalDefaultPassword(r.person_name, r.phone_number);
    // Needs a usable name (2+ letters) and phone (4+ digits), else leave as is.
    if (!/^\p{L}{2}@\d{4}#$/u.test(pw)) continue;
    // eslint-disable-next-line no-await-in-loop
    const res = await query("UPDATE users SET password = ? WHERE id = ? AND password = ?", [await bcrypt.hash(pw, 10), r.id, r.password]);
    if (res?.affectedRows) upgraded++;
  }
  await query("INSERT IGNORE INTO app_migrations (name) VALUES (?)", [MARKER]);
  if (upgraded) console.log(`[workerCredentials] moved ${upgraded} worker account(s) from the old default password to the documented default`);
}
