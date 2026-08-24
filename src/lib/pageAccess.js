import { query } from "@/lib/db";
import { normalizeRole, ROLES, roleOf } from "@/lib/permissions";
import { PAGES, PAGE_KEYS, baselinePagesForRole, isValidPageKey, pageKeyForPath } from "@/lib/pages";

// BUG 14 — Page Access Management backend.
//
// A single per-user, per-page grant table sits on TOP of the existing role
// model. Effective access to a page = the role's baseline (see pages.js) UNION
// any explicit grant here. Super Admin is always full-access and can never be
// locked out (§12). Removing a grant only removes the extra access it added —
// it can never strip a page a role holds by baseline, so existing users never
// lose required access (§16).

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

// Effective accessible page keys for a user = baseline(role) ∪ grants.
// Super Admin → every registered page.
export async function getEffectivePageKeys(userId, role) {
  const canonical = normalizeRole(role);
  if (isSuper(canonical)) return new Set(PAGE_KEYS);
  const baseline = new Set(baselinePagesForRole(canonical));
  const grants = await getUserGrantKeys(userId);
  for (const k of grants) baseline.add(k);
  return baseline;
}

// Does this session's user have access to a given page key? (baseline ∪ grant)
export async function userCanAccessPageKey(session, pageKey) {
  if (!session?.user) return false;
  if (!isValidPageKey(pageKey)) return false;
  const role = roleOf(session);
  if (isSuper(role)) return true;
  if (baselinePagesForRole(role).includes(pageKey)) return true;
  const grants = await getUserGrantKeys(session.user.id);
  return grants.has(pageKey);
}

// Convenience for API routes: authorize by URL path (maps path→page key first).
// Ungated/utility paths (null key) are always allowed.
export async function userCanAccessPath(session, pathname) {
  const key = pageKeyForPath(pathname);
  if (!key) return true;
  return userCanAccessPageKey(session, key);
}

// Reusable API gate. Returns true when the OR of the caller's existing role
// check and page access permits — pass the role-check result you already
// computed so this only ever WIDENS access (grants), never narrows it.
export async function pageAccessAllows(session, pageKey, roleCheckPassed) {
  if (roleCheckPassed) return true;
  return userCanAccessPageKey(session, pageKey);
}

export { PAGES, PAGE_KEYS };
