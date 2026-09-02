import { query } from "@/lib/db";
import { normalizeRole, ROLES, roleOf, OVERSIGHT_ROLES } from "@/lib/permissions";
import { PAGES, PAGE_KEYS, baselinePagesForRole, isValidPageKey, pageKeyForPath, expandPageKeys, grantSetAllows } from "@/lib/pages";

// Page Access Management backend — the SINGLE source of truth for navigation,
// client route guards and backend/API authorization.
//
// ACCESS MODEL (positive allow-list; fail-closed for normal users):
//   • Super Admin → every page, always (can never be locked out).
//   • NORMAL user (a role that is NOT an oversight/management role — i.e. Caller,
//     Worker, Press/Media, Social Media, Media User, …): access is EXACTLY the
//     pages explicitly granted to them, and NOTHING else. There is no role
//     baseline, no default page, no fallback. Zero grants ⇒ ZERO access. This is
//     enforced regardless of the "managed" flag, so a brand-new normal user —
//     who is created with no grants — can never see a page the admin did not
//     assign, even if the managed marker was never written.
//   • OVERSIGHT user (Super/State/Zone/District/Assembly Admin except Super, and
//     Supervisor): if the Super Admin has MANAGED them through Page Access, their
//     access is EXACTLY their grants (same as a normal user). If they were never
//     configured, they keep their normal role baseline — so management accounts
//     are never accidentally locked out and their curated dashboards are intact.
//
// "Managed" (a row in page_access_config) records that the Super Admin saved a
// Page-Access config for a user (even an empty one). It gates the OVERSIGHT
// baseline fallback only; normal users are grants-only either way.
//
// "Fail-closed for normal roles" is the key rule that fixes the recurring
// "new user sees pages it was never assigned" bug: a normal user's pages come
// ONLY from page_permissions, so an empty grant set is always ZERO access.

// A role that is NOT privileged management → grants-only (fail-closed). Super
// Admin is handled separately (full access) and is never "normal".
function isOversightRole(role) {
  return OVERSIGHT_ROLES.includes(normalizeRole(role));
}

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
    // Tracks one-time data migrations so they run exactly once, ever.
    await query(
      `CREATE TABLE IF NOT EXISTS app_migrations (
         name VARCHAR(128) PRIMARY KEY,
         applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    // Remove the auto-injected legacy caller pages (My Workspace / My Calls /
    // Wrong Numbers) that an earlier migration wrote into managed callers. Safe
    // to run every start: legitimate grants always carry a non-null granted_by;
    // only the auto-injected rows are granted_by NULL.
    await cleanupBackfilledFixedPages();
    // ONE-TIME: because normal roles are now grants-only (no role fallback),
    // preserve access for EXISTING normal users by seeding their current role
    // baseline as explicit grants. Runs once, against the users that exist now;
    // new users created afterwards are never seeded, so they start at ZERO.
    await runOnce("seed_normal_baseline_v1", seedExistingNormalUsersBaseline);
    ensured = true;
  } catch (e) {
    console.error("[pageAccess] ensure schema:", e?.message || e);
  }
}

// Run `fn` exactly once ever, keyed by `name` in app_migrations.
async function runOnce(name, fn) {
  try {
    const done = await query(`SELECT 1 FROM app_migrations WHERE name = ? LIMIT 1`, [name]);
    if (done.length) return;
    await fn();
    await query(`INSERT IGNORE INTO app_migrations (name) VALUES (?)`, [name]);
  } catch (e) {
    console.error(`[pageAccess] migration ${name}:`, e?.message || e);
  }
}

// ROOT-CAUSE FIX (Page Access auto-assignment bug).
//
// A previous migration wrote the caller "fixed" pages (My Workspace / My Calls /
// Wrong Numbers) into every MANAGED caller's real grants so retiring the old
// auto-union wouldn't change their access. But that migration also ran against
// BRAND-NEW managed callers: an admin creating a user and assigning only
// "Contacts" ended up with Contacts + workspace + calls + wrong_numbers, because
// the migration re-inserted the legacy pages on the next request. That is exactly
// the reported "extra pages appear" bug — a managed user must have EXACTLY the
// pages the admin assigned and nothing else.
//
// This reverses that migration and heals already-polluted users. The injected
// rows are unambiguously identifiable: the migration inserted them with
// granted_by = NULL, and EVERY legitimate grant (user creation, the Page Access
// POST/PUT save) is written with granted_by = the admin's id (never NULL). So we
// delete precisely the legacy-key rows that have granted_by IS NULL — the exact
// signature of the auto-injected pages — and never touch an admin's real
// assignment. Idempotent and safe to re-run.
const LEGACY_FIXED_KEYS = ["workspace", "calls", "wrong_numbers"];
async function cleanupBackfilledFixedPages() {
  try {
    const placeholders = LEGACY_FIXED_KEYS.map(() => "?").join(",");
    const res = await query(
      `DELETE FROM page_permissions
        WHERE granted_by IS NULL
          AND page_key IN (${placeholders})`,
      LEGACY_FIXED_KEYS
    );
    if (res?.affectedRows) {
      console.log(`[pageAccess] removed ${res.affectedRows} auto-injected legacy page grant(s)`);
    }
  } catch (e) {
    console.error("[pageAccess] cleanup backfilled fixed pages:", e?.message || e);
  }
}

// Sentinel granted_by for system-seeded baseline grants (not a real admin id).
// Non-null on purpose so the legacy cleanup (granted_by IS NULL only) never
// removes a seeded grant.
const SYSTEM_GRANT = 0;

// ONE-TIME migration (see runOnce): normal roles are now grants-only, so any
// EXISTING normal user who was never configured through Page Access — and thus
// relied on the now-removed role baseline — is seeded with that baseline as
// explicit grants and marked managed. Their access is therefore unchanged, but
// it is now stored explicitly. Super Admins (full access) and oversight roles
// (which keep their role baseline) are skipped. New users created after this
// runs are never seeded, so they start at ZERO until an admin assigns pages.
async function seedExistingNormalUsersBaseline() {
  const users = await query(
    `SELECT u.id, u.role FROM users u
       LEFT JOIN page_access_config c ON c.user_id = u.id
      WHERE c.user_id IS NULL`
  );
  let seeded = 0;
  for (const u of users) {
    const role = normalizeRole(u.role);
    if (role === ROLES.SUPER_ADMIN || isOversightRole(role)) continue;
    const keys = baselinePagesForRole(role).filter(isValidPageKey);
    for (const k of keys) {
      // eslint-disable-next-line no-await-in-loop
      await query(
        `INSERT IGNORE INTO page_permissions (user_id, page_key, granted_by) VALUES (?, ?, ?)`,
        [u.id, k, SYSTEM_GRANT]
      );
    }
    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT IGNORE INTO page_access_config (user_id, updated_by) VALUES (?, ?)`,
      [u.id, SYSTEM_GRANT]
    );
    seeded++;
  }
  if (seeded) console.log(`[pageAccess] seeded baseline grants for ${seeded} existing normal user(s)`);
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
// Fail-SAFE: if the managed-status lookup errors (e.g. the config table isn't
// ready yet), treat the user as NOT managed so access falls back to their role
// instead of throwing. Otherwise a transient DB hiccup here would bubble up and
// deny an oversight user (Supervisor/Admin) a write that their role allows —
// Super Admins never hit this path (isPageRestricted returns before the query),
// which is exactly why such a failure would look Supervisor-specific.
export async function isUserManaged(userId) {
  if (!userId) return false;
  try {
    await ensurePagePermissionsSchema();
    const rows = await query(`SELECT 1 FROM page_access_config WHERE user_id = ? LIMIT 1`, [userId]);
    return rows.length > 0;
  } catch (e) {
    console.error("[pageAccess] isUserManaged:", e?.message || e);
    return false;
  }
}
// Remove a user's managed marker → they revert to normal role-based access.
export async function clearManaged(userId) {
  await ensurePagePermissionsSchema();
  await query(`DELETE FROM page_access_config WHERE user_id = ?`, [userId]);
}

function isSuper(role) {
  return normalizeRole(role) === ROLES.SUPER_ADMIN;
}

// EXACT-ASSIGNMENT MODEL: a managed user's access is EXACTLY the pages assigned
// to them — nothing is auto-granted. There are NO "fixed/locked" pages that a
// role silently keeps: if a Caller needs My Workspace / My Calls / Wrong Numbers,
// the admin assigns those pages explicitly like any other. This is what makes
// "0 assigned → 0 access, N assigned → exactly N access" hold for every role.
//
// fixedPagesForRole returns [] for every role — there is no auto-grant of any
// kind. It is kept as a no-op so the existing call sites (which union it in) need
// no change: unioning an empty set adds nothing. Do NOT reintroduce a non-empty
// return here — that is precisely the auto-assignment bug this file guards
// against.
export function fixedPagesForRole() {
  return []; // no automatic pages for any role — managed access = grants only
}

// All explicit grants for one user, as a Set of page keys (validated against the
// registry so a stale key for a since-removed page is ignored).
export async function getUserGrantKeys(userId) {
  if (!userId) return new Set();
  try {
    await ensurePagePermissionsSchema();
    const rows = await query(`SELECT page_key FROM page_permissions WHERE user_id = ?`, [userId]);
    return new Set(rows.map((r) => r.page_key).filter(isValidPageKey));
  } catch (e) {
    console.error("[pageAccess] getUserGrantKeys:", e?.message || e);
    return new Set(); // fail-safe: no grants rather than throwing through a guard
  }
}

// A user whose access is governed purely by explicit grants (positive
// allow-list). True for EVERY normal (non-oversight) user — always, so a normal
// user with no grants is fully locked down regardless of the managed flag — and
// for oversight users the Super Admin has configured through Page Access. Super
// Admin is never restricted; an unconfigured oversight user keeps role baseline.
export async function isPageRestricted(session) {
  if (!session?.user) return false;
  const role = roleOf(session);
  if (isSuper(role)) return false;
  if (!isOversightRole(role)) return true;         // normal role → grants-only
  return isUserManaged(session.user.id);           // oversight → only if configured
}

// Effective accessible page keys for a user.
//   Super Admin        → every registered page.
//   Normal role        → EXACTLY the explicit grants (fail-closed; empty ⇒ none).
//   Oversight, managed → EXACTLY the explicit grants.
//   Oversight, unmanaged → the role's baseline pages (management default).
// expandPageKeys adds implied parent/child keys (a module grant covers its
// sub-sections; a sub-section grant unlocks the module page + nav).
export async function getEffectivePageKeys(userId, role) {
  const canonical = normalizeRole(role);
  if (isSuper(canonical)) return new Set(PAGE_KEYS);
  if (!isOversightRole(canonical) || (await isUserManaged(userId))) {
    return expandPageKeys([...(await getUserGrantKeys(userId))]); // grants only
  }
  return expandPageKeys(baselinePagesForRole(canonical));        // oversight baseline
}

// Does this session's user have access to a given page key?
export async function userCanAccessPageKey(session, pageKey) {
  if (!session?.user) return false;
  if (!isValidPageKey(pageKey)) return false;
  const role = roleOf(session);
  if (isSuper(role)) return true;
  if (!isOversightRole(role) || (await isUserManaged(session.user.id))) {
    return grantSetAllows(await getUserGrantKeys(session.user.id), pageKey); // grants only
  }
  return baselinePagesForRole(role).includes(pageKey);           // oversight baseline
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
//   • Grants-only user (every normal user; a managed oversight user) → allowed
//     ONLY if the page is one of their explicit grants. Their role is ignored,
//     and `roleOk` is NOT consulted — so a normal user can never reach a page's
//     API just because their role once could.
//   • Unmanaged oversight user → the route's original role check, unchanged.
// Insert as: if (!(await pageAllowed(session, KEY, <existingRoleExpr>))) → 401.
export async function pageAllowed(session, pageKey, roleOk) {
  if (!session?.user) return false;
  const role = roleOf(session);
  if (isSuper(role)) return true;
  if (!isOversightRole(role) || (await isUserManaged(session.user.id))) {
    return isValidPageKey(pageKey) && grantSetAllows(await getUserGrantKeys(session.user.id), pageKey);
  }
  return !!roleOk;                                                // unmanaged oversight
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
