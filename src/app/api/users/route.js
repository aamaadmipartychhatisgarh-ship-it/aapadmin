import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isTopAdmin, isOversight, ASSIGNABLE_ROLES } from "@/lib/permissions";
import { pageAllowed, setUserPages } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import bcrypt from "bcryptjs";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);

    // Only top admins (super/state) can create users.
    if (!session || !isTopAdmin(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { username, password, role, home_district_id, scope_zone_id, scope_assembly_id, page_keys } = await req.json();

    if (!username || !password) {
      return Response.json({ message: "Username and password are required" }, { status: 400 });
    }
    // Pages the admin explicitly assigned at creation (optional). Anything else
    // means the user starts with ZERO pages.
    const initialPages = Array.isArray(page_keys) ? page_keys.map((k) => String(k)) : [];

    // Check if user already exists
    const existingUsers = await query("SELECT id FROM users WHERE username = ?", [username]);
    if (existingUsers.length > 0) {
      return Response.json({ message: "User already exists" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = ASSIGNABLE_ROLES.includes(role) ? role : "caller";

    const ins = await query(
      `INSERT INTO users (username, password, role, home_district_id, scope_zone_id, scope_assembly_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, hashedPassword, userRole, home_district_id || null, scope_zone_id || null, scope_assembly_id || null]
    );
    // CRITICAL (exact-assignment model): every new user is Page-Access MANAGED
    // from creation with EXACTLY the pages the admin selected (empty by default).
    // Being managed means their access is precisely their grants — they do NOT
    // fall back to role-baseline/default pages. So a new user with no selection
    // starts with ZERO pages until an admin assigns some via Page Access.
    // setUserPages marks the user managed and stores exactly this set.
    await setUserPages(ins.insertId, initialPages, session.user.id);

    await logAudit(session, { action: "user.create", entityType: "user", entityId: ins.insertId, details: { username, role: userRole, pages: initialPages } });

    return Response.json({ message: "User created successfully", id: ins.insertId }, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    // Oversight roles (supervisors + admins) can read the user list — supervisors
    // need it to assign tasks. Also admitted: a user granted the Contacts page via
    // Page Access, who needs the caller list for Call Assignment. User
    // creation/editing stays top-admin only.
    if (!(await pageAllowed(session, "contacts", session && isOversight(session)))) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const users = await query(
      `SELECT u.id, u.username, u.role, u.created_at, u.last_seen_at, u.is_active,
              u.home_district_id, l.name AS home_district_name,
              u.scope_zone_id, u.scope_assembly_id, u.photo_url
         FROM users u
         LEFT JOIN locations l ON l.id = u.home_district_id`
    );
    return Response.json({ users }, { status: 200 });
  } catch (error) {
    console.error("Error fetching users:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
