import { query } from "@/lib/db";

// The public registration form (/join, /r/<token>) has NO admin (next-auth)
// session — only its own reg_link cookie — so it cannot load a photo through
// /api/media/[file], which returns 401 without an admin session. That is why a
// correctly-resolved Contact photo still rendered as a broken image / initials on
// the public form. Every photo URL handed to the public form is therefore rewritten
// to the form's OWN public image route, which serves the SAME stored bytes (same
// Media Center store, same UUID) but is readable without an admin login.
//
// Only app-relative `/uploads/<file>` paths are rewritten. Anything already absolute
// (http/https) or a data: URI is returned unchanged, and an empty value → null.
export function toPublicRegistrationPhoto(url) {
  const s = String(url || "").trim();
  if (!s) return null;
  const m = s.match(/^\/uploads\/([^/]+)$/);
  if (m) return `/api/public/registration/media/${m[1]}`;
  return s;
}

// Guard for the public image route: true only when `/uploads/<file>` is actually
// stored as someone's photo in a registration-relevant table (contacts / workers /
// reg_people). The route serves ONLY such files, so it is never an open proxy for
// arbitrary uploads (press notes, documents, unrelated media) — it exposes exactly
// the photos the public form already surfaces by URL, and nothing more. Missing
// tables/columns on a given deployment are skipped, not fatal.
export async function isReferencedRegistrationPhoto(file) {
  const name = String(file || "").trim();
  if (!name || name.includes("/") || name.includes("..")) return false;
  const url = `/uploads/${name}`;
  const checks = [
    ["contacts", "photo_url"],
    ["workers", "photo_url"],
    ["reg_people", "photo_url"],
  ];
  for (const [table, col] of checks) {
    try {
      const rows = await query(`SELECT 1 FROM \`${table}\` WHERE \`${col}\` = ? LIMIT 1`, [url]);
      if (rows.length) return true;
    } catch { /* table/column absent on this deployment — try the next */ }
  }
  return false;
}
