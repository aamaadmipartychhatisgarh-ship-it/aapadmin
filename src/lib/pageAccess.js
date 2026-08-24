import { query } from "@/lib/db";
import { normalizeRole, ROLES, roleOf } from "@/lib/permissions";
import { PAGES, PAGE_KEYS, baselinePagesForRole, isValidPageKey, pageKeyForPath } from "@/lib/pages";

// Page Access Management backend.
//
// Model (OVERRIDE, not additive):
//   • Super Admin  → every page, always (can never be locked out).
//   • A user with ONE OR MORE assigned pages is "page-restricted": their access
//     is EXACTLY the assigned pages — their role's default modules are
//     suppressed. Assigning "Page A" therefore grants Page A and nothing else;
//     it never pulls in My Calls / Workspace / Contacts / Reports / etc.
//   • A user with ZERO assigned pages keeps their normal role-based access
//     (unchanged) — so existing users who were never assigned a page are wholly
//     unaffected.
//
// This one rule is the single source of truth for navigation, client route
// guards and backend/API authorization, so what a user sees always matches what
// the server allows. Removing a page revokes it (and its features) immediately
// on the next load; there is no fallback/inheritance that re-adds modules.

let ensured = false;
export async function ensurePagePermissionsSchema() {
  if (ensured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS page_permissions (
         id INT AUTO_INCREMENT PRIMARY KEY,
         user_id INT NOT NULL,
         page_key VARCHAR(64) NOT NULL,
         granted_by INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uq_user_page (user_id, page_key),
         KEY idx_user (user_id),
         KEY idx_page (page_key)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    ensured = true;
  } catch (e) {
    console.error("[pageAccess] ensure schema:", e?.message || e);
  }
}

function isSuper(role) {
  return normalizeRole(role) === ROLES.SUPER_ADMIN;
}

// All explicit grants for one user, as a Set of page keys (validated against the
// registry so a stale key for a since-removed page is ignored).
export async function getUserGrantKeys(userId) {
  if (!userId) return new Set();
  await ensurePagePermissionsSchema();
  const rows = await query(`SELECT page_key FROM page_permissions WHERE user_id = ?`, [userId]);
  return new Set(rows.map((r) => r.page_key).filter(isValidPageKey));
}

// Is this user page-restricted (has ≥1 explicit page assignment)? Super Admin
// is never restricted. A restricted user's access is EXACTLY their assigned
// pages; a non-restricted user falls back to their role.
export async function isPageRestricted(session) {
  if (!session?.user) return false;
  if (isSuper(roleOf(session))) return false;
  const grants = await getUserGrantKeys(session.user.id);
  return grants.size > 0;
}
export async function isUserRestricted(userId, role) {
  if (isSuper(role)) return false;
  const grants = await getUserGrantKeys(userId);
  return grants.size > 0;
}

// Effective accessible page keys for a user (OVERRIDE model).
//   Super Admin → every registered page.
//   ≥1 assignment → exactly the assigned pages.
//   0 assignments → the role's baseline pages (unchanged legacy behaviour).
export async function getEffectivePageKeys(userId, role) {
  const canonical = normalizeRole(role);
  if (isSuper(canonical)) return new Set(PAGE_KEYS);
  const grants = await getUserGrantKeys(userId);
  if (grants.size > 0) return new Set(grants);
  return new Set(baselinePagesForRole(canonical));
}

// Does this session's user have access to a given page key? (OVERRIDE model)
export async function userCanAccessPageKey(session, pageKey) {
  if (!session?.user) return false;
  if (!isValidPageKey(pageKey)) return false;
  const role = roleOf(session);
  if (isSuper(role)) return true;
  const grants = await getUserGrantKeys(session.user.id);
  if (grants.size > 0) return grants.has(pageKey);           // restricted → assigned only
  return baselinePagesForRole(role).includes(pageKey);        // unrestricted → role baseline
}

// Convenience for API routes: authorize by URL path (maps path→page key first).
// Ungated/utility paths (null key) are always allowed.
export async function userCanAccessPath(session, pathname) {
  const key = pageKeyForPath(pathname);
  if (!key) return true;
  return userCanAccessPageKey(session, key);
}

// THE reusable API gate. `roleOk` is the route's existing role-check result.
//   • Super Admin → allowed.
//   • Restricted user → allowed ONLY if the page is one of their assigned pages
//     (their role is ignored — assigning Page A must not unlock this route).
//   • Unrestricted user → the route's original role check, unchanged (so no
//     existing user's access changes).
// Insert as: if (!(await pageAllowed(session, KEY, <existingRoleExpr>))) → 401.
export async function pageAllowed(session, pageKey, roleOk) {
  if (!session?.user) return false;
  if (isSuper(roleOf(session))) return true;
  const grants = await getUserGrantKeys(session.user.id);
  if (grants.size > 0) return isValidPageKey(pageKey) && grants.has(pageKey);
  return !!roleOk;
}

// Replace a user's entire page assignment set with `pageKeys` (exact set) in one
// transaction — the persistence behind the multi-select assignment UI. Returns
// the final set. Unknown keys are ignored.
export async function setUserPages(userId, pageKeys, grantedBy) {
  await ensurePagePermissionsSchema();
  const wanted = [...new Set((pageKeys || []).filter(isValidPageKey))];
  const existing = await getUserGrantKeys(userId);
  const toAdd = wanted.filter((k) => !existing.has(k));
  const toRemove = [...existing].filter((k) => !wanted.includes(k));
  if (toRemove.length) {
    await query(
      `DELETE FROM page_permissions WHERE user_id = ? AND page_key IN (${toRemove.map(() => "?").join(",")})`,
      [userId, ...toRemove]
    );
  }
  for (const k of toAdd) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT IGNORE INTO page_permissions (user_id, page_key, granted_by) VALUES (?, ?, ?)`,
      [userId, k, grantedBy ?? null]
    );
  }
  return wanted;
}

export { PAGES, PAGE_KEYS };
