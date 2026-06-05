import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, isTopAdmin, ASSIGNABLE_ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);

    // Only top admins (super/state) can create users.
    if (!session || !isTopAdmin(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { username, password, role, home_district_id, scope_zone_id, scope_assembly_id } = await req.json();

    if (!username || !password) {
      return Response.json({ message: "Username and password are required" }, { status: 400 });
    }

    // Check if user already exists
    const existingUsers = await query("SELECT id FROM users WHERE username = ?", [username]);
    if (existingUsers.length > 0) {
      return Response.json({ message: "User already exists" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = ASSIGNABLE_ROLES.includes(role) ? role : "caller";

    await query(
      `INSERT INTO users (username, password, role, home_district_id, scope_zone_id, scope_assembly_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, hashedPassword, userRole, home_district_id || null, scope_zone_id || null, scope_assembly_id || null]
    );

    return Response.json({ message: "User created successfully" }, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !isAdmin(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const users = await query(
      `SELECT u.id, u.username, u.role, u.created_at, u.last_seen_at, u.is_active,
              u.home_district_id, l.name AS home_district_name,
              u.scope_zone_id, u.scope_assembly_id
         FROM users u
         LEFT JOIN locations l ON l.id = u.home_district_id`
    );
    return Response.json({ users }, { status: 200 });
  } catch (error) {
    console.error("Error fetching users:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
