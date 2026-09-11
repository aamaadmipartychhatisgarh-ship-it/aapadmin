import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local if present; real environment variables already set win.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ---------------------------------------------------------------------------
// Store the OTP SMS provider config in the database (app_settings), so the app
// can send OTPs WITHOUT any host environment-variable setup. The running app
// reads these at send time (env still wins if ever set). The key value is never
// printed.
//
// Usage (from the app directory, against the production DB):
//   node scripts/set-sms-config.mjs <FAST2SMS_API_KEY>
//   FAST2SMS_KEY=xxxx node scripts/set-sms-config.mjs
// Optional: SMS_PROVIDER=fast2sms (default) | msg91 | generic
// ---------------------------------------------------------------------------

const key = (process.env.FAST2SMS_KEY || process.argv[2] || '').trim();
const provider = (process.env.SMS_PROVIDER || 'fast2sms').trim();

if (!key && provider === 'fast2sms') {
  console.error('Provide the Fast2SMS API key:  node scripts/set-sms-config.mjs <API_KEY>');
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aapadmin',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

console.log(`Connected to ${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'aapadmin'}`);
console.log('(Confirm this is the database https://aapchhattisgarh.in actually uses.)\n');

await conn.query(
  `CREATE TABLE IF NOT EXISTS app_settings (
     setting_key   VARCHAR(64) PRIMARY KEY,
     setting_value TEXT NULL,
     updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
);

const upsert = (k, v) => conn.query(
  `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
  [k, v]
);

await upsert('OTP_SMS_PROVIDER', provider);
if (key) await upsert('FAST2SMS_API_KEY', key);

console.log(`✓ Saved OTP_SMS_PROVIDER="${provider}"` + (key ? ` and FAST2SMS_API_KEY (length ${key.length}, value hidden).` : '.'));
console.log('\nOTP will now send directly through the provider on the next request — no app restart needed.');

await conn.end();
