import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ---------------------------------------------------------------------------
// Read-only diagnostic: shows EXACTLY what the OTP sender will see for the SMS
// provider config, from BOTH channels (environment variables and the
// app_settings table), against the same database the app uses. It never prints
// a secret value — only set/MISSING and the non-secret provider name.
//
// Run on the production server, from the app directory:
//   node scripts/check-sms-config.mjs
// ---------------------------------------------------------------------------

const KEYS = [
  'OTP_SMS_PROVIDER',
  'FAST2SMS_API_KEY', 'FAST2SMS_ROUTE', 'FAST2SMS_SENDER_ID',
  'MSG91_AUTHKEY', 'MSG91_TEMPLATE_ID',
  'OTP_SMS_URL',
];
const SECRET = new Set(['FAST2SMS_API_KEY', 'MSG91_AUTHKEY']); // never show value

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aapadmin',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

console.log(`DB: ${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'aapadmin'}`);
console.log('(This must be the SAME database https://aapchhattisgarh.in uses.)\n');

let db = {};
try {
  const [rows] = await conn.query(
    `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (${KEYS.map(() => '?').join(',')})`,
    KEYS
  );
  for (const r of rows) db[r.setting_key] = r.setting_value;
  console.log('app_settings table: found and readable.\n');
} catch (e) {
  console.log(`app_settings table: NOT readable → ${e.message}`);
  console.log('(If it does not exist yet, run scripts/set-sms-config.mjs or the SQL from the task.)\n');
}

const show = (v, key) => {
  const val = (v ?? '').toString().trim();
  if (!val) return 'MISSING';
  if (SECRET.has(key)) return `set (length ${val.length})`;
  return `"${val}"`;
};

console.log('key                 | env            | app_settings   | EFFECTIVE');
console.log('--------------------+----------------+----------------+----------------');
for (const k of KEYS) {
  const envV = process.env[k];
  const dbV = db[k];
  const eff = (envV && envV.trim()) || (dbV && dbV.trim()) || '';
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`${pad(k, 19)} | ${pad(show(envV, k), 14)} | ${pad(show(dbV, k), 14)} | ${show(eff, k)}`);
}

const provider = ((process.env.OTP_SMS_PROVIDER || db.OTP_SMS_PROVIDER || '')).trim().toLowerCase();
const key = (process.env.FAST2SMS_API_KEY || db.FAST2SMS_API_KEY || '').trim();
console.log('\nVerdict:');
if (provider === 'fast2sms' && key) {
  console.log('  ✓ OTP is configured (fast2sms + key present). If OTP still fails, the');
  console.log('    cause is provider-side — check the "[otp] send failed … Fast2SMS <code>"');
  console.log('    line in the server log (402=no balance, 401=bad key, 400=bad request).');
} else if (!provider) {
  console.log('  ✗ OTP_SMS_PROVIDER is not set in either channel → the app returns 503.');
  console.log('    Fix: run  node scripts/set-sms-config.mjs <FAST2SMS_KEY>  against THIS database.');
} else if (provider === 'fast2sms' && !key) {
  console.log('  ✗ Provider is fast2sms but FAST2SMS_API_KEY is missing → the app returns 502/503.');
  console.log('    Fix: run  node scripts/set-sms-config.mjs <FAST2SMS_KEY>  against THIS database.');
} else {
  console.log(`  Provider="${provider}". Ensure its credentials are present above.`);
}

await conn.end();
