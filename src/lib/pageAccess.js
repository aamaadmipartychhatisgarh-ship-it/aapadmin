import { query } from "@/lib/db";
import { normalizeRole, ROLES, roleOf } from "@/lib/permissions";
import { PAGES, PAGE_KEYS, baselinePagesForRole, isValidPageKey, pageKeyForPath } from "@/lib/pages";

// Page Access Management backend.
//
// Model (OVERRIDE, not additive) — a user is either MANAGED or not:
//   • Super Admin  → every page, always (can never be locked out).
//   • MANAGED user (the Super Admin has saved a Page-Access config for them,
//     even an empty one): access is EXACTLY their assigned pages — role default
//     modules are fully suppressed. Assigning "Page A" grants Page A and nothing
//     else; removing every page leaves them with NO pages (role defaults do NOT
//     reappear).
//   • UNMANAGED user (never configured through Page Access): normal role-based
//     access, unchanged — so existing users who were never touched keep working.
//
// "Managed" is tracked by a row in page_access_config, written on every save
// (including an empty save), so the empty state is respected and never silently
// falls back to the role. This one rule is the single source of truth for
// navigation, client route guards and backend/API authorization.

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
    // Marks a user as "managed by Page Access" — present ⇒ their access is
    // exactly their page_permissions rows (even zero), so an empty config is
    // respected and never falls back to role defaults.
    await query(
      `CREATE TABLE IF NOT EXISTS page_access_config (
         user_id INT PRIMARY KEY,
         updated_by INT NULL,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    ensured = true;
  } catch (e) {
    console.error("[pageAccess] ensure schema:", e?.message || e);
  }
}

// Mark a user as Page-Access managed (idempotent). Called on every save.
export async function markManaged(userId, by) {
  await ensurePagePermissionsSchema();
  await query(
    `INSERT INTO page_access_config (user_id, updated_by) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
    [userId, by ?? null]
  );
}
// Is this user managed by Page Access (has a saved config, possibly empty)?
export async function isUserManaged(userId) {
  if (!userId) return false;
  await ensurePagePermissionsSchema();
  const rows = await query(`SELECT 1 FROM page_access_config WHERE user_id = ? LIMIT 1`, [userId]);
  return rows.length > 0;
}
// Remove a user's managed marker → they revert to normal role-based access.
export async function clearManaged(userId) {
  await ensurePagePermissionsSchema();
  await query(`DELETE FROM page_access_config WHERE user_id = ?`, [userId]);
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

// Is this user page-restricted (managed by Page Access)? Super Admin never is.
// A managed user's access is EXACTLY their assigned pages (even zero); an
// unmanaged user falls back to their role.
export async function isPageRestricted(session) {
  if (!session?.user) return false;
  if (isSuper(roleOf(session))) return false;
  return isUserManaged(session.user.id);
}

// Effective accessible page keys for a user (OVERRIDE model).
//   Super Admin → every registered page.
//   Managed     → exactly the assigned pages (may be empty → no pages).
//   Unmanaged   → the role's baseline pages (unchanged legacy behaviour).
export async function getEffectivePageKeys(userId, role) {
  const canonical = normalizeRole(role);
  if (isSuper(canonical)) return new Set(PAGE_KEYS);
  if (await isUserManaged(userId)) return new Set(await getUserGrantKeys(userId));
  return new Set(baselinePagesForRole(canonical));
}

// Does this session's user have access to a given page key? (OVERRIDE model)
export async function userCanAccessPageKey(session, pageKey) {
  if (!session?.user) return false;
  if (!isValidPageKey(pageKey)) return false;
  const role = roleOf(session);
  if (isSuper(role)) return true;
  if (await isUserManaged(session.user.id)) {                 // managed → assigned only
    return (await getUserGrantKeys(session.user.id)).has(pageKey);
  }
  return baselinePagesForRole(role).includes(pageKey);        // unmanaged → role baseline
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
  if (await isUserManaged(session.user.id)) {
    return isValidPageKey(pageKey) && (await getUserGrantKeys(session.user.id)).has(pageKey);
  }
  return !!roleOk;
}

// Replace a user's entire page assignment set with `pageKeys` (exact set) in one
// transaction — the persistence behind the multi-select assignment UI. Returns
// the final set. Unknown keys are ignored.
export async function setUserPages(userId, pageKeys, grantedBy) {
  await ensurePagePermissionsSchema();
  // Mark managed FIRST so even an empty save (revoke-all) is respected and the
  // user does not fall back to role defaults.
  await markManaged(userId, grantedBy);
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
