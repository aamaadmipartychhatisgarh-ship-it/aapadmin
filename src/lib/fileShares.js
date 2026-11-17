import crypto from "crypto";
import { query } from "@/lib/db";

// Secure, expiring share links for exported files (PDF, Excel .xlsx / .xls, CSV) — the fallback the common sharing system
// (components/pdfShare) uses where the device cannot share the FILE itself (desktop browsers without file sharing).
//
// Security model (no public links to confidential reports):
//   • Only a signed-in user can create a link, and only for the exact file they just generated (validated by its bytes).
//   • Opening a link ALSO requires signing in. The person who created it can always open it; anyone else must have access
//     to the page the file was exported from (Page Access / role, via userCanAccessPath) — the same people who could produce
//     that report themselves. An unguessable 256-bit token is still required on top.
//   • Links expire after FILE_SHARE_TTL_HOURS; expired files are deleted (opportunistically on every new share).
// Storage: 1 MB chunks (pdf_share_chunks) so a large export never exceeds max_allowed_packet. (Table names are kept from the
// first, PDF-only version so links created by it keep their data.)

export const FILE_SHARE_TTL_HOURS = 72;
export const FILE_SHARE_MAX_BYTES = 25 * 1024 * 1024;
const CHUNK = 1024 * 1024;
const MAX_PER_USER_PER_DAY = 200;

export const SHARE_TYPES = {
  pdf: { mime: "application/pdf", ext: "pdf", label: "PDF" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx", label: "Excel" },
  xls: { mime: "application/vnd.ms-excel", ext: "xls", label: "Excel" },
  csv: { mime: "text/csv", ext: "csv", label: "CSV" },
};

let ensured = false;
async function hasColumn(table, col) {
  const r = await query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1", [table, col]);
  return r.length > 0;
}
async function ensureSchema() {
  if (ensured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS pdf_shares (
       id INT AUTO_INCREMENT PRIMARY KEY,
       token CHAR(43) NOT NULL,
       filename VARCHAR(200) NOT NULL,
       size_bytes INT NOT NULL,
       created_by INT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       expires_at DATETIME NOT NULL,
       opened_count INT NOT NULL DEFAULT 0,
       UNIQUE KEY uq_pdf_share_token (token),
       KEY idx_pdf_share_expires (expires_at),
       KEY idx_pdf_share_user (created_by, created_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  await query(
    `CREATE TABLE IF NOT EXISTS pdf_share_chunks (
       share_id INT NOT NULL,
       seq INT NOT NULL,
       data MEDIUMBLOB NOT NULL,
       PRIMARY KEY (share_id, seq)
     ) ENGINE=InnoDB`
  );
  if (!(await hasColumn("pdf_shares", "file_type"))) await query("ALTER TABLE pdf_shares ADD COLUMN file_type VARCHAR(8) NOT NULL DEFAULT 'pdf'");
  if (!(await hasColumn("pdf_shares", "source_path"))) await query("ALTER TABLE pdf_shares ADD COLUMN source_path VARCHAR(255) NULL");
  ensured = true;
}

// What kind of file these bytes really are (never trusts the client's label alone).
export function detectFileType(buf, filename) {
  const head = buf.subarray(0, 8);
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  const ext = (String(filename || "").match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return ext === "xls" ? "xls" : "xlsx"; // zip container
  if (head.readUInt32BE(0) === 0xd0cf11e0) return "xls";                                                                     // OLE2 (BIFF .xls)
  if (ext === "csv" && !buf.subarray(0, 8192).includes(0)) return "csv";                                                     // text, no NULs
  return null;
}

// A file name safe for a Content-Disposition header and for display, with the right extension.
export function cleanShareFilename(name, type) {
  const ext = SHARE_TYPES[type]?.ext || "pdf";
  let n = String(name || "").replace(/[\r\n"\\/<>:|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!n) n = "document";
  return new RegExp(`\\.${ext}$`, "i").test(n) ? n : `${n.replace(/\.(pdf|xlsx|xls|csv)$/i, "")}.${ext}`;
}

async function purgeExpired() {
  const old = await query("SELECT id FROM pdf_shares WHERE expires_at < NOW() LIMIT 200");
  if (!old.length) return;
  const ids = old.map((r) => r.id);
  await query(`DELETE FROM pdf_share_chunks WHERE share_id IN (${ids.map(() => "?").join(",")})`, ids);
  await query(`DELETE FROM pdf_shares WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
}

// A same-site page path ('/dashboard/...'), or null.
function cleanPath(p) {
  const s = String(p || "").trim();
  return /^\/[A-Za-z0-9/_\-.[\]]{0,250}$/.test(s) && !s.startsWith("//") ? s : null;
}

// Store one file; returns { token, expires_at, type } or { error, status }.
export async function createFileShare(buf, filename, userId, sourcePath) {
  await ensureSchema();
  if (!buf || !buf.length) return { error: "The file is empty.", status: 400 };
  if (buf.length > FILE_SHARE_MAX_BYTES) return { error: `This file is larger than ${FILE_SHARE_MAX_BYTES / 1024 / 1024} MB and cannot be shared as a link. Download it and attach it instead.`, status: 413 };
  const type = detectFileType(buf, filename);
  if (!type) return { error: "Only PDF, Excel and CSV files can be shared.", status: 415 };
  const [cnt] = await query("SELECT COUNT(*) AS n FROM pdf_shares WHERE created_by <=> ? AND created_at > NOW() - INTERVAL 1 DAY", [userId ?? null]);
  if (Number(cnt?.n || 0) >= MAX_PER_USER_PER_DAY) return { error: "Too many share links today. Please try again tomorrow.", status: 429 };
  await purgeExpired().catch(() => {});
  const token = crypto.randomBytes(32).toString("base64url");   // 43 chars, 256 bits
  const res = await query(
    `INSERT INTO pdf_shares (token, filename, size_bytes, created_by, expires_at, file_type, source_path)
     VALUES (?, ?, ?, ?, NOW() + INTERVAL ${FILE_SHARE_TTL_HOURS} HOUR, ?, ?)`,
    [token, cleanShareFilename(filename, type), buf.length, userId ?? null, type, cleanPath(sourcePath)]
  );
  const id = res.insertId;
  try {
    for (let off = 0, seq = 0; off < buf.length; off += CHUNK, seq++) {
      // eslint-disable-next-line no-await-in-loop
      await query("INSERT INTO pdf_share_chunks (share_id, seq, data) VALUES (?, ?, ?)", [id, seq, buf.subarray(off, off + CHUNK)]);
    }
  } catch (e) {
    await query("DELETE FROM pdf_share_chunks WHERE share_id = ?", [id]).catch(() => {});
    await query("DELETE FROM pdf_shares WHERE id = ?", [id]).catch(() => {});
    throw e;
  }
  const [row] = await query("SELECT expires_at FROM pdf_shares WHERE id = ?", [id]);
  return { token, expires_at: row?.expires_at || null, type };
}

// The share behind a token (metadata only), or null when unknown / expired.
export async function findFileShare(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ""))) return null;
  await ensureSchema();
  const [s] = await query("SELECT id, filename, size_bytes, created_by, file_type, source_path FROM pdf_shares WHERE token = ? AND expires_at > NOW() LIMIT 1", [token]);
  return s || null;
}

// The bytes of a share (found with findFileShare), or null when incomplete.
export async function readFileShareBytes(share) {
  const chunks = await query("SELECT data FROM pdf_share_chunks WHERE share_id = ? ORDER BY seq", [share.id]);
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.data)));
  if (buf.length !== Number(share.size_bytes)) return null;              // incomplete upload: never serve a broken file
  query("UPDATE pdf_shares SET opened_count = opened_count + 1 WHERE id = ?", [share.id]).catch(() => {});
  return buf;
}
