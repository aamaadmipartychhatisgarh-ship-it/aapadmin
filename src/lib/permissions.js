// Central role + permission model.
//
// Canonical roles (8), highest authority first:
//   super_admin > state_admin > zone_admin > district_admin > assembly_admin
//   supervisor (oversight, cross-cutting) , caller (logs calls) , worker (org member)
//
// Legacy roles still accepted from old sessions / data:
//   admin  -> super_admin
//   user   -> caller
//   agent  -> caller

export const ROLES = {
  SUPER_ADMIN: "super_admin",
  STATE_ADMIN: "state_admin",
  ZONE_ADMIN: "zone_admin",
  DISTRICT_ADMIN: "district_admin",
  ASSEMBLY_ADMIN: "assembly_admin",
  SUPERVISOR: "supervisor",
  CALLER: "caller",
  WORKER: "worker",
};

// Normalize any incoming role string (legacy or canonical) to canonical.
export function normalizeRole(role) {
  switch (role) {
    case "admin": return ROLES.SUPER_ADMIN;
    case "user":
    case "agent": return ROLES.CALLER;
    default: return role;
  }
}

// Authority rank — higher number = more authority. Used for "can this role
// manage that role" and for hierarchy gating.
const RANK = {
  [ROLES.SUPER_ADMIN]: 100,
  [ROLES.STATE_ADMIN]: 90,
  [ROLES.ZONE_ADMIN]: 70,
  [ROLES.DISTRICT_ADMIN]: 60,
  [ROLES.ASSEMBLY_ADMIN]: 50,
  [ROLES.SUPERVISOR]: 40,
  [ROLES.CALLER]: 20,
  [ROLES.WORKER]: 10,
};

export function roleRank(role) {
  return RANK[normalizeRole(role)] ?? 0;
}

export function roleOf(session) {
  return normalizeRole(session?.user?.role);
}

// --- Capability groups -----------------------------------------------------

// Admin-tier roles can manage org config, users, master data within their scope.
export const ADMIN_ROLES = [
  ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.ZONE_ADMIN,
  ROLES.DISTRICT_ADMIN, ROLES.ASSEMBLY_ADMIN,
];

// Roles with read oversight over calling/operations (admins + supervisor).
export const OVERSIGHT_ROLES = [...ADMIN_ROLES, ROLES.SUPERVISOR];

// Roles that actually log calls / work a queue.
export const CALLER_ROLES = [ROLES.CALLER];

export function isAdmin(session) {
  return ADMIN_ROLES.includes(roleOf(session));
}
// Top-level admin only (full system control) — for user creation, master data.
export function isTopAdmin(session) {
  const r = roleOf(session);
  return r === ROLES.SUPER_ADMIN || r === ROLES.STATE_ADMIN;
}
export function isOversight(session) {
  return OVERSIGHT_ROLES.includes(roleOf(session));
}
export function isCaller(session) {
  return roleOf(session) === ROLES.CALLER;
}
export function isSupervisorRole(session) {
  return roleOf(session) === ROLES.SUPERVISOR;
}

// --- Geographic scope ------------------------------------------------------
// Returns the scope a user is limited to. super_admin/state_admin = whole state.
export function userScope(user) {
  const role = normalizeRole(user?.role);
  if (role === ROLES.SUPER_ADMIN || role === ROLES.STATE_ADMIN) {
    return { level: "state", id: null };
  }
  if (role === ROLES.ZONE_ADMIN && user.scope_zone_id) {
    return { level: "zone", id: user.scope_zone_id };
  }
  if (role === ROLES.DISTRICT_ADMIN && user.home_district_id) {
    return { level: "district", id: user.home_district_id };
  }
  if (role === ROLES.ASSEMBLY_ADMIN && user.scope_assembly_id) {
    return { level: "assembly", id: user.scope_assembly_id };
  }
  // supervisor/caller/worker: scope by home_district if present, else none.
  if (user.home_district_id) return { level: "district", id: user.home_district_id };
  return { level: "none", id: null };
}

// Human-readable label for a role.
export const ROLE_LABELS = {
  [ROLES.SUPER_ADMIN]: "Super Admin",
  [ROLES.STATE_ADMIN]: "State Admin",
  [ROLES.ZONE_ADMIN]: "Zone Admin",
  [ROLES.DISTRICT_ADMIN]: "District Admin",
  [ROLES.ASSEMBLY_ADMIN]: "Assembly Admin",
  [ROLES.SUPERVISOR]: "Supervisor",
  [ROLES.CALLER]: "Caller",
  [ROLES.WORKER]: "Worker",
};

export function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] || role;
}

// All assignable roles for the user-creation dropdown.
export const ASSIGNABLE_ROLES = [
  ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.ZONE_ADMIN,
  ROLES.DISTRICT_ADMIN, ROLES.ASSEMBLY_ADMIN,
  ROLES.SUPERVISOR, ROLES.CALLER, ROLES.WORKER,
];

// --- Scope SQL helpers ----------------------------------------------------
//
// Given a session and a row alias (the table that has zone_id/district_id/
// assembly_id columns), return { sql, params } you can splice into a WHERE.
// super_admin / state_admin / supervisor → no filter (whole state).
// zone_admin     → zone_id = scope_zone_id
// district_admin → district_id = home_district_id
// assembly_admin → assembly_id = scope_assembly_id
// caller / worker → district_id = home_district_id (they only see their area)
//
// usage:
//   const f = await scopeFilter(session, "w", { kind: "worker" });
//   query(`SELECT * FROM workers w ${f.where} ORDER BY ...`, [...f.params, ...]);
export async function scopeFilter(session, alias = "", _opts = {}) {
  const role = roleOf(session);
  const u = session?.user || {};
  const tag = alias ? `${alias}.` : "";

  // Top-level admins + supervisor see everything by default.
  if (role === ROLES.SUPER_ADMIN || role === ROLES.STATE_ADMIN || role === ROLES.SUPERVISOR) {
    return { where: "", params: [] };
  }

  // The columns we'll filter on — match the conventional names across tables.
  if (role === ROLES.ZONE_ADMIN && u.scope_zone_id) {
    return { where: `AND ${tag}zone_id = ?`, params: [u.scope_zone_id] };
  }
  if (role === ROLES.DISTRICT_ADMIN && u.home_district_id) {
    return { where: `AND ${tag}district_id = ?`, params: [u.home_district_id] };
  }
  if (role === ROLES.ASSEMBLY_ADMIN && u.scope_assembly_id) {
    return { where: `AND ${tag}assembly_id = ?`, params: [u.scope_assembly_id] };
  }
  if ((role === ROLES.CALLER || role === ROLES.WORKER) && u.home_district_id) {
    return { where: `AND ${tag}district_id = ?`, params: [u.home_district_id] };
  }

  // Scoped user with NO scope set → hide everything (strict mode).
  // This prevents a Zone Admin without scope_zone_id from seeing all-state data.
  return { where: "AND 1 = 0", params: [] };
}

// Synchronous scope filter.
//   user  – session.user with scope columns loaded (home_district_id, scope_zone_id, scope_assembly_id)
//   alias – table alias that owns the geo columns (e.g. "c", "w", "t")
//   opts.cols – which geo columns the table actually HAS. Defaults to all three.
//               Pass only what exists, e.g. { cols: ["district_id"] } for tasks.
//
// Because not every table has zone_id/assembly_id, this resolves the user's
// territory through the location hierarchy when the exact column is missing.
// Hierarchy: assembly → district → lok_sabha → zone.
export function scopeFilterSync(user, alias = "", opts = {}) {
  const role = normalizeRole(user?.role);
  const tag = alias ? `${alias}.` : "";
  const cols = opts.cols || ["zone_id", "district_id", "assembly_id"];
  const has = (c) => cols.includes(c);

  // Top-level admins + supervisor see everything by default.
  if (role === ROLES.SUPER_ADMIN || role === ROLES.STATE_ADMIN || role === ROLES.SUPERVISOR) {
    return { where: "", params: [] };
  }

  // --- ZONE ADMIN ---------------------------------------------------------
  if (role === ROLES.ZONE_ADMIN) {
    if (!user.scope_zone_id) return { where: "AND 1 = 0", params: [] };
    if (has("zone_id")) {
      return { where: `AND ${tag}zone_id = ?`, params: [user.scope_zone_id] };
    }
    if (has("district_id")) {
      // districts whose lok_sabha's parent is this zone
      return {
        where: `AND ${tag}district_id IN (
          SELECT d.id FROM locations d
          JOIN locations ls ON ls.id = d.parent_id AND ls.type = 'lok_sabha'
          WHERE ls.parent_id = ?
        )`,
        params: [user.scope_zone_id],
      };
    }
    if (has("assembly_id")) {
      return {
        where: `AND ${tag}assembly_id IN (
          SELECT a.id FROM locations a
          JOIN locations d ON d.id = a.parent_id AND d.type = 'district'
          JOIN locations ls ON ls.id = d.parent_id AND ls.type = 'lok_sabha'
          WHERE ls.parent_id = ?
        )`,
        params: [user.scope_zone_id],
      };
    }
    return { where: "AND 1 = 0", params: [] };
  }

  // --- DISTRICT ADMIN (also caller/worker) --------------------------------
  if (role === ROLES.DISTRICT_ADMIN || role === ROLES.CALLER || role === ROLES.WORKER) {
    if (!user.home_district_id) return { where: "AND 1 = 0", params: [] };
    if (has("district_id")) {
      return { where: `AND ${tag}district_id = ?`, params: [user.home_district_id] };
    }
    if (has("assembly_id")) {
      // assemblies whose parent is this district
      return {
        where: `AND ${tag}assembly_id IN (SELECT id FROM locations WHERE parent_id = ? AND type = 'assembly')`,
        params: [user.home_district_id],
      };
    }
    if (has("zone_id")) {
      // zone that owns this district (district → lok_sabha → zone)
      return {
        where: `AND ${tag}zone_id = (
          SELECT ls.parent_id FROM locations d
          JOIN locations ls ON ls.id = d.parent_id
          WHERE d.id = ?
        )`,
        params: [user.home_district_id],
      };
    }
    return { where: "AND 1 = 0", params: [] };
  }

  // --- ASSEMBLY ADMIN -----------------------------------------------------
  if (role === ROLES.ASSEMBLY_ADMIN) {
    if (!user.scope_assembly_id) return { where: "AND 1 = 0", params: [] };
    if (has("assembly_id")) {
      return { where: `AND ${tag}assembly_id = ?`, params: [user.scope_assembly_id] };
    }
    if (has("district_id")) {
      // district that owns this assembly
      return {
        where: `AND ${tag}district_id = (SELECT parent_id FROM locations WHERE id = ?)`,
        params: [user.scope_assembly_id],
      };
    }
    if (has("zone_id")) {
      return {
        where: `AND ${tag}zone_id = (
          SELECT ls.parent_id FROM locations a
          JOIN locations d ON d.id = a.parent_id
          JOIN locations ls ON ls.id = d.parent_id
          WHERE a.id = ?
        )`,
        params: [user.scope_assembly_id],
      };
    }
    return { where: "AND 1 = 0", params: [] };
  }

  return { where: "AND 1 = 0", params: [] };
}

// The session.user object from NextAuth only carries id/name/role today (see
// session callback in lib/auth.js). For scoping we need the scope columns too.
// loadUserScope() fetches them once and caches on the session-shaped object.
export async function loadUserScope(session, query) {
  if (!session?.user?.id) return null;
  if (session.user.home_district_id !== undefined) return session.user; // already loaded
  const rows = await query(
    `SELECT home_district_id, scope_zone_id, scope_lok_sabha_id, scope_assembly_id FROM users WHERE id = ?`,
    [session.user.id]
  );
  if (rows[0]) Object.assign(session.user, rows[0]);
  return session.user;
}

