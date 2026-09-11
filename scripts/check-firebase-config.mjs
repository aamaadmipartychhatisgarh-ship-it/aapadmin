import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ---------------------------------------------------------------------------
// Read-only diagnostic: shows whether the Firebase web config the OTP flow needs
// is present, from BOTH env and the app_settings table, against the SAME
// database the app uses. It NEVER prints a config value — only set/MISSING and
// where each value comes from.
//
// Run on the production server, from the app directory:
//   node scripts/check-firebase-config.mjs
// ---------------------------------------------------------------------------

const KEYS = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID', 'FIREBASE_MESSAGING_SENDER_ID'];
const REQUIRED = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID'];

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aapadmin',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});
console.log(`DB: ${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'aapadmin'}`);
console.log('(This MUST be the same database https://aapchhattisgarh.in uses.)\n');

let db = {}, dbOk = false;
try {
  const [rows] = await conn.query(
    `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (${KEYS.map(() => '?').join(',')})`,
    KEYS
  );
  for (const r of rows) db[r.setting_key] = r.setting_value;
  dbOk = true;
  console.log('app_settings query: OK\n');
} catch (e) {
  console.log(`app_settings query: FAILED → ${e.message}\n`);
}

console.log('key                          | env | app_settings | EFFECTIVE');
console.log('-----------------------------+-----+--------------+----------');
const present = (v) => (v && String(v).trim() ? 'set' : ' - ');
for (const k of KEYS) {
  const envV = process.env[k];
  const dbV = db[k];
  const eff = (envV && envV.trim()) || (dbV && dbV.trim()) ? 'PRESENT' : 'MISSING';
  console.log(`${k.padEnd(28)} | ${present(envV).padEnd(3)} | ${present(dbV).padEnd(12)} | ${eff}`);
}

const missing = REQUIRED.filter((k) => !((process.env[k] || '').trim() || (db[k] || '').trim()));
console.log('\nVerdict:');
if (missing.length === 0) {
  console.log('  ✓ All required Firebase config is present. The registration form will load Firebase.');
  console.log('    If it STILL says "not available", the browser could not init Firebase — check that');
  console.log('    aapchhattisgarh.in is in Firebase Console → Authentication → Settings → Authorized domains.');
} else {
  console.log(`  ✗ Missing required keys: [${missing.join(', ')}]`);
  console.log('    Fix: set them via  node scripts/set-firebase-config.mjs  against THIS database, then reload.');
  if (!dbOk) console.log('    NOTE: the app_settings query failed — the app likely cannot read this DB either.');
}

await conn.end();
