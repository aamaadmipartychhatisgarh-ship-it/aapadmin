import crypto from "crypto";
import { query } from "@/lib/db";

// Share Report — secure, server-side storage of a report's CONFIG (module +
// filters + view/group/sort), referenced by an opaque, unguessable token. The
// token carries NO report data; when a shared link is opened, the report is
// re-run live for the OPENING user through the normal Reports engine, so the
// existing permission + geo-scope rules apply and no data is ever exposed in the
// URL. Mirrors the saved_reports pattern (config JSON keyed to a row).

let ensured = false;
async function ensureSchema() {
  if (ensured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS report_shares (
       id INT AUTO_INCREMENT PRIMARY KEY,
       token VARCHAR(64) NOT NULL,
       module_key VARCHAR(64) NOT NULL,
       config LONGTEXT NOT NULL,
       created_by INT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       expires_at TIMESTAMP NULL,
       UNIQUE KEY uq_report_share_token (token),
       KEY idx_report_share_creator (created_by)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  ensured = true;
}

// Shared links are valid for this many days (uses an expiring token so a link is
// never a permanent public handle to report configuration).
const SHARE_TTL_DAYS = 30;

// Create a share row and return its opaque token + expiry. `config` is stored
// verbatim (JSON) — it is the exact current report state the client captured.
export async function createReportShare({ moduleKey, config, createdBy }) {
  await ensureSchema();
  const token = crypto.randomBytes(24).toString("base64url"); // 192-bit, URL-safe
  const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 86400000);
  await query(
    `INSERT INTO report_shares (token, module_key, config, created_by, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [token, String(moduleKey), JSON.stringify(config || {}), createdBy ?? null, expiresAt]
  );
  return { token, expires_at: expiresAt.toISOString() };
}

// Resolve a token to its stored { module, config }. Returns { notFound } or
// { expired } states so the caller can respond with a clear, distinct message.
export async function getReportShare(token) {
  await ensureSchema();
  const t = String(token || "").trim();
  if (!t) return { notFound: true };
  const [row] = await query(
    `SELECT module_key, config, expires_at FROM report_shares WHERE token = ? LIMIT 1`,
    [t]
  );
  if (!row) return { notFound: true };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return { expired: true };
  let config = {};
  try { config = JSON.parse(row.config); } catch { config = {}; }
  return { module: row.module_key, config };
}
