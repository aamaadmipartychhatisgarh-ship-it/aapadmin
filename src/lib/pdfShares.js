import crypto from "crypto";
import { query } from "@/lib/db";

// Secure, expiring share links for exported PDFs — the fallback the common PDF sharing system (components/pdfShare) uses
// where the device cannot share the PDF FILE itself (desktop browsers without file sharing). The exact PDF the user just
// generated is uploaded once and served at an unguessable link (256-bit random token) until it expires. Only a signed-in
// user can create a link; anyone holding the link can open that one PDF until it expires — which is what sharing means.
//
// Storage: the PDF bytes are kept in 1 MB chunks (pdf_share_chunks), so a large export never exceeds the database's
// max_allowed_packet. Expired links are purged opportunistically on every new share.

export const PDF_SHARE_TTL_DAYS = 7;
export const PDF_SHARE_MAX_BYTES = 25 * 1024 * 1024;
const CHUNK = 1024 * 1024;
const MAX_PER_USER_PER_DAY = 200;

let ensured = false;
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
  ensured = true;
}

// A file name safe for a Content-Disposition header and for display.
export function cleanPdfFilename(name) {
  let n = String(name || "").replace(/[\r\n"\\/<>:|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!n) n = "document";
  return /\.pdf$/i.test(n) ? n : `${n}.pdf`;
}

async function purgeExpired() {
  const old = await query("SELECT id FROM pdf_shares WHERE expires_at < NOW() LIMIT 200");
  if (!old.length) return;
  const ids = old.map((r) => r.id);
  await query(`DELETE FROM pdf_share_chunks WHERE share_id IN (${ids.map(() => "?").join(",")})`, ids);
  await query(`DELETE FROM pdf_shares WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
}

// Store one PDF; returns { token, expires_at } or { error, status }.
export async function createPdfShare(buf, filename, userId) {
  await ensureSchema();
  if (!buf || !buf.length) return { error: "The PDF is empty.", status: 400 };
  if (buf.length > PDF_SHARE_MAX_BYTES) return { error: `This PDF is larger than ${PDF_SHARE_MAX_BYTES / 1024 / 1024} MB and cannot be shared as a link. Download it and attach it instead.`, status: 413 };
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return { error: "Only PDF files can be shared.", status: 415 };
  const [cnt] = await query("SELECT COUNT(*) AS n FROM pdf_shares WHERE created_by <=> ? AND created_at > NOW() - INTERVAL 1 DAY", [userId ?? null]);
  if (Number(cnt?.n || 0) >= MAX_PER_USER_PER_DAY) return { error: "Too many share links today. Please try again tomorrow.", status: 429 };
  await purgeExpired().catch(() => {});
  const token = crypto.randomBytes(32).toString("base64url");   // 43 chars, 256 bits
  const res = await query(
    `INSERT INTO pdf_shares (token, filename, size_bytes, created_by, expires_at) VALUES (?, ?, ?, ?, NOW() + INTERVAL ${PDF_SHARE_TTL_DAYS} DAY)`,
    [token, cleanPdfFilename(filename), buf.length, userId ?? null]
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
  return { token, expires_at: row?.expires_at || null };
}

// The PDF behind a link, or null when the link is unknown or expired.
export async function readPdfShare(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ""))) return null;
  await ensureSchema();
  const [s] = await query("SELECT id, filename, size_bytes FROM pdf_shares WHERE token = ? AND expires_at > NOW() LIMIT 1", [token]);
  if (!s) return null;
  const chunks = await query("SELECT data FROM pdf_share_chunks WHERE share_id = ? ORDER BY seq", [s.id]);
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.data)));
  if (buf.length !== Number(s.size_bytes)) return null;              // incomplete upload: never serve a broken file
  query("UPDATE pdf_shares SET opened_count = opened_count + 1 WHERE id = ?", [s.id]).catch(() => {});
  return { filename: s.filename, buf };
}
