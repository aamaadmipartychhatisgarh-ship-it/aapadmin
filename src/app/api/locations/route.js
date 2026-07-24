import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const parentId = searchParams.get("parent_id");
    // Fetch all assemblies under a Lok Sabha (2 levels: lok_sabha → district → assembly).
    const assembliesOfLokSabha = searchParams.get("assemblies_of_lok_sabha");

    if (assembliesOfLokSabha) {
      const rows = await query(
        `SELECT a.id, a.type, a.name, a.parent_id
           FROM locations a
           JOIN locations d ON d.id = a.parent_id AND d.type = 'district'
          WHERE a.type = 'assembly' AND d.parent_id = ?
          ORDER BY a.name ASC`,
        [assembliesOfLokSabha]
      );
      return Response.json({ locations: rows }, { status: 200 });
    }

    let sql = "SELECT id, type, name, parent_id FROM locations WHERE 1=1";
    const params = [];

    if (type) {
      sql += " AND type = ?";
      params.push(type);
    }

    if (parentId) {
      sql += " AND parent_id = ?";
      params.push(parentId);
    }

    const allRows = searchParams.get("all");

    // Default behavior for legacy callers: if no type, no parent_id, and not asked for all → return roots.
    if (!type && !parentId && !allRows) {
      sql += " AND parent_id IS NULL";
    }

    sql += " ORDER BY name ASC";

    const locations = await query(sql, params);
    return Response.json({ locations }, { status: 200 });
  } catch (error) {
    console.error("Error fetching locations:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { type, name, parent_id } = await req.json();

    if (!type || !name) {
      return Response.json({ message: "Type and name are required" }, { status: 400 });
    }

    const res = await query(
      "INSERT INTO locations (type, name, parent_id) VALUES (?, ?, ?)",
      [type, name, parent_id || null]
    );

    return Response.json({ message: "Location added successfully", id: res.insertId }, { status: 201 });
  } catch (error) {
    console.error("Error adding location:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
