import { query } from "@/lib/db";
import { normalizeRole, ROLES, roleOf } from "@/lib/permissions";
import { PAGES, PAGE_KEYS, baselinePagesForRole, isValidPageKey, pageKeyForPath, expandPageKeys, grantSetAllows, childKeysOf } from "@/lib/pages";

// Page Access Management backend — the SINGLE source of truth for navigation,
// client route guards and backend/API authorization.
//
// ACCESS MODEL — a user is either MANAGED or not, and that flag is the correct
// discriminator between a NEW user and an EXISTING (never-configured) user:
//   • Super Admin → every page, always (can never be locked out).
//   • MANAGED user (a row exists in page_access_config — the Super Admin has
//     taken control of this user's pages through Page Access, even to an empty
//     set): access is EXACTLY their explicit grants, nothing role-derived.
//     Assigning "Tasks" grants Tasks and nothing else; removing every page
//     leaves ZERO pages (no role default reappears). A brand-NEW user is created
//     managed-with-zero-grants (see the users API), so "new user ⇒ no pages"
//     falls out of this automatically — no default/role/fallback page is added.
//   • UNMANAGED user (never configured through Page Access): their normal
//     role-based baseline, UNCHANGED. This is what preserves EXISTING users —
//     an old user who was working before this feature keeps exactly the access
//     they had, and is NEVER shown "no pages" as a side effect of the new-user
//     rule. Their access derives from their role, so it is inherently
//     self-restoring and no migration can wipe it.
//
// The new-user rule is therefore implemented ONLY at creation time (the user is
// marked managed with an empty grant set) — never by resetting existing users.
// This is the DB lifecycle state, never a fragile "grants.length === 0" guess:
// an existing user may legitimately have zero grants, but as long as they are
// UNMANAGED they keep their role baseline.

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
    // Tracks one-time data migrations so each runs exactly once, ever.
    await query(
      `CREATE TABLE IF NOT EXISTS app_migrations (
         name VARCHAR(128) PRIMARY KEY,
         applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    // Remove EVERY auto-granted page row so a normal user only ever holds the
    // pages an admin explicitly assigned. Runs every start (idempotent) so a
    // stale/older deploy is self-healed the moment this code goes live.
    await cleanupAutoGrantedPages();
    // ONE-TIME: the model changed from "parent grant implies all children" to
    // "children are independent". Preserve access for users who were granted a
    // PARENT (Media / Social Command / Leader Assessment / Administration) — which
    // used to cover every sub-tab — by materialising all of that parent's current
    // children as explicit grants. After this, sub-tabs are assigned one-by-one.
    await runOnce("expand_parent_grants_v1", expandExistingParentGrants);
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

// Parents whose old "grant = whole module" behaviour must be preserved as
// explicit child grants under the new container-only model.
const HIERARCHICAL_PARENTS = ["media", "social_management", "leader_assessment", "administration"];
async function expandExistingParentGrants() {
  let added = 0;
  for (const parent of HIERARCHICAL_PARENTS) {
    const children = childKeysOf(parent).filter(isValidPageKey);
    for (const child of children) {
      // Copy the parent grant to the child (same user + same granted_by, so the
      // repair cleanup never treats it as machine-injected). INSERT IGNORE keeps
      // it idempotent and never overwrites an existing explicit child grant.
      // eslint-disable-next-line no-await-in-loop
      const res = await query(
        `INSERT IGNORE INTO page_permissions (user_id, page_key, granted_by)
         SELECT pp.user_id, ?, pp.granted_by
           FROM page_permissions pp
          WHERE pp.page_key = ?`,
        [child, parent]
      );
      added += res?.affectedRows || 0;
    }
  }
  if (added) console.log(`[pageAccess] expanded ${added} parent grant(s) into child sub-tab grants`);
}

// REPAIR MIGRATION — undoes two earlier bad migrations and, crucially, RESTORES
// existing users that were wrongly reset, without ever touching a real
// assignment. It removes only machine-written rows, identified precisely:
//   • granted_by IS NULL for a legacy caller page (workspace/calls/wrong_numbers)
//     — the retired "fixed pages" backfill that polluted managed callers.
//   • granted_by = 0 — the retired baseline SEED (0 was never a real admin id).
// EVERY legitimate assignment (user creation with page_keys, the Page Access
// POST/PUT save) carries granted_by = the admin's real user id (> 0), so those
// are never touched. Deleting the seed rows AND their seed-written managed marker
// (updated_by = 0) returns those users to the UNMANAGED state, where
// getEffectivePageKeys gives them their role baseline again — i.e. their old
// access is restored automatically, no snapshot needed. Runs every start
// (idempotent), so a database left in a bad state by any prior deploy self-heals
// the instant this code goes live. It never resets a genuinely-configured user
// (real granted_by / non-zero updated_by) and never creates or default-assigns
// any page.
const LEGACY_FIXED_KEYS = ["workspace", "calls", "wrong_numbers"];
async function cleanupAutoGrantedPages() {
  try {
    const placeholders = LEGACY_FIXED_KEYS.map(() => "?").join(",");
    const res = await query(
      `DELETE FROM page_permissions
        WHERE granted_by = 0
           OR (granted_by IS NULL AND page_key IN (${placeholders}))`,
      LEGACY_FIXED_KEYS
    );
    if (res?.affectedRows) {
      console.log(`[pageAccess] removed ${res.affectedRows} auto-granted page row(s)`);
    }
    // Drop the managed marker the retired seed wrote (updated_by = 0) so those
    // users revert to UNMANAGED and regain their role baseline. Only markers with
    // no admin-written grants remain are removed — a user later configured by an
    // admin has a real updated_by and is left untouched.
    await query(
      `DELETE c FROM page_access_config c
        WHERE c.updated_by = 0
          AND NOT EXISTS (SELECT 1 FROM page_permissions p WHERE p.user_id = c.user_id)`
    );
  } catch (e) {
    console.error("[pageAccess] cleanup auto-granted pages:", e?.message || e);
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

// A MANAGED user's access is EXACTLY the pages assigned to them — nothing is
// auto-granted. There are NO "fixed/locked" pages a managed user silently keeps:
// if a managed Caller needs My Workspace / My Calls / Wrong Numbers, the admin
// assigns those explicitly like any other page. So for a MANAGED user
// "0 assigned → 0 access, N assigned → exactly N access" always holds. (An
// UNMANAGED user is separate: they keep their role baseline, so existing users
// are never stripped of access — see getEffectivePageKeys.)
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

// Is this user page-restricted (governed EXACTLY by their explicit grants)?
//   • Super Admin      → never restricted (full access).
//   • MANAGED user     → restricted (a Page-Access config row exists — the admin
//                        has taken control of their pages, even to an empty set).
//                        A NEW user is created managed-with-zero-grants, so this
//                        is how "new user ⇒ no pages" is enforced.
//   • UNMANAGED user   → NOT restricted → keeps their normal role baseline, so an
//                        existing user who was never configured is never
//                        stripped of the access they already had.
// This managed/unmanaged split is the correct discriminator between "new user"
// (created managed-empty) and "existing user" (unmanaged, role baseline) — it is
// the DB lifecycle state, never a fragile "grants.length === 0" guess.
export async function isPageRestricted(session) {
  if (!session?.user) return false;
  if (isSuper(roleOf(session))) return false;
  return isUserManaged(session.user.id);
}

// Effective accessible page keys for a user.
//   Super Admin  → every registered page.
//   Managed      → EXACTLY the explicit grants (may be empty ⇒ no pages). New
//                  users land here with zero grants.
//   Unmanaged    → the role's baseline pages (existing behaviour preserved).
// expandPageKeys adds implied parent/child keys (a module grant covers its
// sub-sections; a sub-section grant unlocks the module page + nav).
export async function getEffectivePageKeys(userId, role) {
  const canonical = normalizeRole(role);
  if (isSuper(canonical)) return new Set(PAGE_KEYS);
  if (await isUserManaged(userId)) {
    return expandPageKeys([...(await getUserGrantKeys(userId))]); // managed → grants only
  }
  return expandPageKeys(baselinePagesForRole(canonical));        // unmanaged → role baseline
}

// Does this session's user have access to a given page key?
export async function userCanAccessPageKey(session, pageKey) {
  if (!session?.user) return false;
  if (!isValidPageKey(pageKey)) return false;
  const role = roleOf(session);
  if (isSuper(role)) return true;
  if (await isUserManaged(session.user.id)) {
    return grantSetAllows(await getUserGrantKeys(session.user.id), pageKey); // managed → grants
  }
  return baselinePagesForRole(role).includes(pageKey);           // unmanaged → role baseline
}

// Convenience for API routes: authorize by URL path (maps path→page key first).
// Ungated/utility paths (null key) are always allowed.
export async function userCanAccessPath(session, pathname) {
  const key = pageKeyForPath(pathname);
  if (!key) return true;
  return userCanAccessPageKey(session, key);
}

// THE reusable API gate. `roleOk` is the route's existing role-check result.
//   • Super Admin      → allowed.
//   • Managed user     → allowed ONLY if the page is one of their explicit grants
//     (their role is ignored — an empty grant set means no API access either).
//   • Unmanaged user   → the route's original role check, unchanged (so an
//     existing user's API access is exactly what it always was).
// Insert as: if (!(await pageAllowed(session, KEY, <existingRoleExpr>))) → 401.
export async function pageAllowed(session, pageKey, roleOk) {
  if (!session?.user) return false;
  const role = roleOf(session);
  if (isSuper(role)) return true;
  if (await isUserManaged(session.user.id)) {
    return isValidPageKey(pageKey) && grantSetAllows(await getUserGrantKeys(session.user.id), pageKey);
  }
  return !!roleOk;                                                // unmanaged → role check
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
