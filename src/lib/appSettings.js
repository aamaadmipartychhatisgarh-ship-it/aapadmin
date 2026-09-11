import { query } from "@/lib/db";

// A tiny key/value store for server-side runtime configuration that must be
// changeable WITHOUT redeploying or setting host environment variables — e.g.
// the SMS provider credentials for OTP. Values are read only by server code
// (route handlers / lib), never sent to the browser, and never logged.
//
// Environment variables always take precedence over these rows (see otpSender),
// so a value here is a fallback for hosts where setting env vars is impractical.

let ensured = false;

export async function ensureAppSettingsSchema() {
  if (ensured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS app_settings (
         setting_key   VARCHAR(64) PRIMARY KEY,
         setting_value TEXT NULL,
         updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    ensured = true;
  } catch (e) {
    console.error("[settings] ensure schema:", e?.message || e);
  }
}

// Fetch several settings at once → { key: value }. Missing keys are absent.
export async function getSettings(keys) {
  await ensureAppSettingsSchema();
  const list = (keys || []).filter(Boolean);
  if (!list.length) return {};
  const placeholders = list.map(() => "?").join(",");
  const rows = await query(
    `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (${placeholders})`,
    list
  );
  const out = {};
  for (const r of rows) out[r.setting_key] = r.setting_value;
  return out;
}

export async function getSetting(key) {
  const m = await getSettings([key]);
  return m[key] ?? null;
}

// Insert or update one setting (idempotent upsert on the primary key).
export async function setSetting(key, value) {
  await ensureAppSettingsSchema();
  await query(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value]
  );
}
