import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSuperAdmin, normalizeRole, roleLabel, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { ensurePagePermissionsSchema, setUserPages, markManaged, clearManaged } from "@/lib/pageAccess";
import { PAGES, PAGE_KEYS, isValidPageKey, getPage } from "@/lib/pages";

// BUG 14 — Page Access Management (Super Admin only).
//   GET    → registry of pages, grantable users, and all current grants
//   POST   → grant a page to a user  { user_id, page_key }
//   DELETE → revoke a page from a user  ?user_id=&page_key=  (or JSON body)
//
// Uniqueness (user_id + page_key) is enforced at the DB level, so a duplicate
// grant is rejected with a clear message rather than creating a second row.

function guard(session) {
  return session && isSuperAdmin(session);
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!guard(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensurePagePermissionsSchema();

    // Grantable users = everyone except Super Admins (who already hold every
    // page and must never be managed through this system, §12). Distinct rows
    // by id (no duplicates). username doubles as the display name in this app.
    const users = await query(
      `SELECT id, username, role, photo_url, is_active FROM users ORDER BY username`
    );
    // Which users are Page-Access managed (their access = exactly their grants,
    // even if empty). Used so the UI shows the true DB state, not role defaults.
    const managedRows = await query(`SELECT user_id FROM page_access_config`);
    const managedSet = new Set(managedRows.map((r) => r.user_id));
    const grantable = users
      .filter((u) => normalizeRole(u.role) !== ROLES.SUPER_ADMIN)
      .map((u) => ({
        id: u.id,
        username: u.username,
        role: normalizeRole(u.role),
        role_label: roleLabel(u.role),
        photo_url: u.photo_url ?? null,
        is_active: u.is_active,
        managed: managedSet.has(u.id),
      }));

    const grantRows = await query(
      `SELECT pp.id, pp.user_id, pp.page_key, pp.granted_by, pp.created_at,
              u.username, u.role, gb.username AS granted_by_name
         FROM page_permissions pp
         JOIN users u ON u.id = pp.user_id
         LEFT JOIN users gb ON gb.id = pp.granted_by
        ORDER BY pp.created_at DESC, pp.id DESC`
    );
    // Only surface grants for pages still present in the registry.
    const grants = grantRows
      .filter((g) => isValidPageKey(g.page_key))
      .map((g) => ({
        id: g.id,
        user_id: g.user_id,
        username: g.username,
        role: normalizeRole(g.role),
        role_label: roleLabel(g.role),
        page_key: g.page_key,
        page_label: getPage(g.page_key)?.label || g.page_key,
        granted_by: g.granted_by,
        granted_by_name: g.granted_by_name ?? null,
        created_at: g.created_at,
      }));

    // The page catalogue for the dropdown + views, each with the roles that
    // already hold it by baseline (so the UI can show baseline vs granted).
    const pages = PAGES.map((p) => ({
      key: p.key,
      label: p.label,
      href: p.href,
      icon: p.icon,
      baseline_roles: p.roles.map((r) => normalizeRole(r)),
    }));

    return NextResponse.json({ pages, users: grantable, grants });
  } catch (err) {
    console.error("page-access GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!guard(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensurePagePermissionsSchema();

    const body = await req.json().catch(() => ({}));
    const userId = Number(body.user_id);
    const pageKey = String(body.page_key || "").trim();

    if (!Number.isInteger(userId) || userId <= 0 || !pageKey) {
      return NextResponse.json({ message: "user_id and page_key are required." }, { status: 400 });
    }
    if (!isValidPageKey(pageKey)) {
      return NextResponse.json({ message: "Unknown page." }, { status: 400 });
    }

    const [target] = await query(`SELECT id, username, role FROM users WHERE id = ?`, [userId]);
    if (!target) return NextResponse.json({ message: "User not found." }, { status: 404 });
    if (normalizeRole(target.role) === ROLES.SUPER_ADMIN) {
      return NextResponse.json({ message: "Super Admin already has access to every page." }, { status: 400 });
    }

    // (Under the managed/override model a role baseline never auto-grants, so a
    // page in the role's baseline is still a meaningful explicit assignment.)
    const existing = await query(
      `SELECT id FROM page_permissions WHERE user_id = ? AND page_key = ?`,
      [userId, pageKey]
    );
    if (existing.length > 0) {
      return NextResponse.json({ message: "This user already has access to this page." }, { status: 409 });
    }

    try {
      await query(
        `INSERT INTO page_permissions (user_id, page_key, granted_by) VALUES (?, ?, ?)`,
        [userId, pageKey, session.user.id]
      );
    } catch (e) {
      // Race: the unique key caught a concurrent duplicate insert.
      if (e?.code === "ER_DUP_ENTRY") {
        return NextResponse.json({ message: "This user already has access to this page." }, { status: 409 });
      }
      throw e;
    }
    // Granting a page puts the user under Page-Access management.
    await markManaged(userId, session.user.id);

    await logAudit(session, {
      action: "page_access.grant", entityType: "page_permission", entityId: userId,
      details: { user_id: userId, username: target.username, page_key: pageKey },
    });
    return NextResponse.json({ message: `Access to ${getPage(pageKey)?.label || pageKey} granted to ${target.username}.` }, { status: 201 });
  } catch (err) {
    console.error("page-access POST error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// Set a user's ENTIRE page assignment to an exact set (multi-select save).
// Body: { user_id, page_keys: string[] }. Replaces prior assignments — pages
// not in the list are removed, so saving [] clears all assignments (the user
// reverts to their normal role access).
export async function PUT(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!guard(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensurePagePermissionsSchema();

    const body = await req.json().catch(() => ({}));
    const userId = Number(body.user_id);
    const reset = body.reset === true;
    const pageKeys = Array.isArray(body.page_keys) ? body.page_keys.map((k) => String(k)) : null;
    if (!Number.isInteger(userId) || userId <= 0 || (pageKeys === null && !reset)) {
      return NextResponse.json({ message: "user_id and page_keys[] are required." }, { status: 400 });
    }
    const [target] = await query(`SELECT id, username, role FROM users WHERE id = ?`, [userId]);
    if (!target) return NextResponse.json({ message: "User not found." }, { status: 404 });
    if (normalizeRole(target.role) === ROLES.SUPER_ADMIN) {
      return NextResponse.json({ message: "Super Admin already has access to every page." }, { status: 400 });
    }

    // Reset → remove the managed marker AND all grants, reverting the user to
    // their normal role-based access (the escape hatch from Page-Access control).
    if (reset) {
      await setUserPages(userId, [], session.user.id); // clears grants (also marks managed)
      await clearManaged(userId);                       // then unmanage → role default
      await logAudit(session, {
        action: "page_access.reset", entityType: "page_permission", entityId: userId,
        details: { user_id: userId, username: target.username },
      });
      return NextResponse.json({ message: `${target.username} reverted to role-based access.`, pages: [], reset: true });
    }

    const final = await setUserPages(userId, pageKeys, session.user.id);
    await logAudit(session, {
      action: "page_access.set", entityType: "page_permission", entityId: userId,
      details: { user_id: userId, username: target.username, pages: final },
    });
    return NextResponse.json({ message: `Updated page access for ${target.username}.`, pages: final });
  } catch (err) {
    console.error("page-access PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!guard(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensurePagePermissionsSchema();

    const { searchParams } = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const userId = Number(body.user_id ?? searchParams.get("user_id"));
    const pageKey = String(body.page_key ?? searchParams.get("page_key") ?? "").trim();

    if (!Number.isInteger(userId) || userId <= 0 || !pageKey) {
      return NextResponse.json({ message: "user_id and page_key are required." }, { status: 400 });
    }

    const res = await query(
      `DELETE FROM page_permissions WHERE user_id = ? AND page_key = ?`,
      [userId, pageKey]
    );
    if (!res.affectedRows) {
      return NextResponse.json({ message: "No such grant to remove." }, { status: 404 });
    }

    await logAudit(session, {
      action: "page_access.revoke", entityType: "page_permission", entityId: userId,
      details: { user_id: userId, page_key: pageKey },
    });
    return NextResponse.json({ message: "Access removed." });
  } catch (err) {
    console.error("page-access DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
