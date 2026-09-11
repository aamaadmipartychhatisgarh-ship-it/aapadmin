import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ---------------------------------------------------------------------------
// Store the Firebase WEB config in app_settings so the OTP flow (Firebase Phone
// Auth) works without host env-var setup. These values are NOT secrets — they
// ship to the browser. Read them from your Firebase console:
//   Project settings → General → Your apps → Web app → SDK setup and config.
//
// Usage (values from the firebaseConfig object):
//   FIREBASE_API_KEY=... FIREBASE_AUTH_DOMAIN=...firebaseapp.com \
//   FIREBASE_PROJECT_ID=... FIREBASE_APP_ID=... FIREBASE_MESSAGING_SENDER_ID=... \
//   node scripts/set-firebase-config.mjs
// ---------------------------------------------------------------------------

const FIELDS = {
  FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
  FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_APP_ID: process.env.FIREBASE_APP_ID,
  FIREBASE_MESSAGING_SENDER_ID: process.env.FIREBASE_MESSAGING_SENDER_ID,
};

const missing = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID']
  .filter((k) => !FIELDS[k] || !String(FIELDS[k]).trim());
if (missing.length) {
  console.error('Missing required values: ' + missing.join(', '));
  console.error('Set them as environment variables (see the header of this script) and re-run.');
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aapadmin',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});
console.log(`Connected to ${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'aapadmin'}\n`);

await conn.query(
  `CREATE TABLE IF NOT EXISTS app_settings (
     setting_key   VARCHAR(64) PRIMARY KEY,
     setting_value TEXT NULL,
     updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
);

for (const [k, v] of Object.entries(FIELDS)) {
  if (!v || !String(v).trim()) continue;
  await conn.query(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [k, String(v).trim()]
  );
  console.log(`  ✓ ${k}`);
}

console.log('\nFirebase web config saved. The registration form will use Firebase Phone Auth on the next load.');
await conn.end();
