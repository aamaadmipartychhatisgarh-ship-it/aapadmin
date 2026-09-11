import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local if present, but NEVER override variables already set in the
// real environment — so on the production server the actual DB_* env wins.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ---------------------------------------------------------------------------
// Safe, idempotent repair of the Super Admin sign-in.
//
// Sign-in ("superadmin" / "superadmin") is rejected when the users row is
// missing, inactive, or its bcrypt hash no longer matches. This script repairs
// ONLY that one account, in whatever database the app's own DB_* env points to,
// using the SAME hashing the app uses (bcryptjs, cost 10). It is NON-destructive:
//   • no table is dropped or wiped, no other user is touched;
//   • it upserts by username (never creates a duplicate superadmin);
//   • it only widens schema where required (add is_active, widen the role enum),
//     which preserves all existing data.
//
// Usage on the production server (from the app directory):
//   node scripts/fix-superadmin.mjs
// Override the target account if ever needed:
//   SA_USERNAME=superadmin SA_PASSWORD=superadmin node scripts/fix-superadmin.mjs
// ---------------------------------------------------------------------------

const USERNAME = (process.env.SA_USERNAME || 'superadmin').trim();
const PASSWORD = process.env.SA_PASSWORD || 'superadmin'; // not trimmed — matches sign-in
const ROLE = 'super_admin';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aapadmin',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

console.log(`Connected to ${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'aapadmin'} as ${process.env.DB_USER || 'root'}`);
console.log('(Confirm the host/database above is the one https://aapchhattisgarh.in actually uses.)\n');

// --- ensure the columns the sign-in relies on exist ------------------------
const [cols] = await conn.query('SHOW COLUMNS FROM users');
const names = cols.map((c) => c.Field);

if (!names.includes('is_active')) {
  console.log('• users.is_active missing → adding it (default 1).');
  await conn.query("ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1");
}

// The role column must be able to store 'super_admin'. If it is an older ENUM
// that predates the canonical roles, widen it (non-destructive) so the value is
// stored intact rather than silently truncated.
const roleCol = cols.find((c) => c.Field === 'role');
if (roleCol && /^enum\(/i.test(roleCol.Type) && !/super_admin/i.test(roleCol.Type)) {
  console.log('• users.role enum has no super_admin → widening to the canonical roles.');
  try {
    await conn.query(`ALTER TABLE users MODIFY COLUMN role ENUM(
      'super_admin','state_admin','zone_admin','district_admin','assembly_admin',
      'supervisor','press_media','social_media','media_user','caller','worker',
      'admin','user','agent') NOT NULL DEFAULT 'caller'`);
  } catch (e) {
    console.log(`  (could not widen enum: ${e.message}); trying VARCHAR fallback.`);
    await conn.query("ALTER TABLE users MODIFY COLUMN role VARCHAR(32) NOT NULL DEFAULT 'caller'");
  }
}

// --- upsert ONLY the superadmin account ------------------------------------
const hash = await bcrypt.hash(PASSWORD, 10);
const [existing] = await conn.query('SELECT id, role, is_active FROM users WHERE username = ?', [USERNAME]);

if (existing.length === 0) {
  await conn.query(
    'INSERT INTO users (username, password, role, is_active) VALUES (?, ?, ?, 1)',
    [USERNAME, hash, ROLE]
  );
  console.log(`\n✓ Created "${USERNAME}" (role=${ROLE}, active).`);
} else {
  if (existing.length > 1) console.log(`! Found ${existing.length} rows named "${USERNAME}" — repairing all of them.`);
  await conn.query(
    'UPDATE users SET password = ?, is_active = 1, role = ? WHERE username = ?',
    [hash, ROLE, USERNAME]
  );
  console.log(`\n✓ Reset password + reactivated "${USERNAME}" (role=${ROLE}). No duplicate created.`);
}

// --- verify exactly what the sign-in will do -------------------------------
const [check] = await conn.query('SELECT id, username, role, is_active, password FROM users WHERE username = ? ORDER BY id LIMIT 1', [USERNAME]);
const row = check[0];
const ok = row && row.is_active !== 0 && await bcrypt.compare(PASSWORD, row.password);
console.log(`\nVerification: bcrypt.compare("${PASSWORD}") = ${ok ? 'MATCH ✓' : 'NO MATCH ✗'}, is_active=${row?.is_active}, role=${row?.role}, id=${row?.id}`);
console.log(ok
  ? `\nDone. Sign in with  ${USERNAME} / ${PASSWORD}  on web and PWA (use a fresh/incognito window to drop any stale session).`
  : '\nSomething is still off — check that this is the production database and re-run.');

await conn.end();
