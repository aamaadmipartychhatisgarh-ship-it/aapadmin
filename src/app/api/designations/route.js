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

    // ?stats=1 adds how many contacts use each designation — used by the merge
    // tool to show impact and to pick the busiest row as the merge target.
    // Order by the custom party-hierarchy sort_order first, then name. Rows
    // without a sort_order (NULL) fall to the end, alphabetically. If the
    // sort_order column hasn't been added yet (migration not run), fall back
    // to plain name ordering so the app keeps working.
    const withStats = new URL(req.url).searchParams.get("stats") === "1";
    const hasSortOrder =
      (await query("SHOW COLUMNS FROM designations LIKE 'sort_order'")).length > 0;
    const orderBy = hasSortOrder
      ? "(d.sort_order IS NULL), d.sort_order ASC, d.name ASC"
      : "d.name ASC";
    const orderByPlain = hasSortOrder
      ? "(sort_order IS NULL), sort_order ASC, name ASC"
      : "name ASC";

    const designations = withStats
      ? await query(
          `SELECT d.id, d.name, COUNT(c.id) AS contact_count
             FROM designations d
             LEFT JOIN contacts c ON c.designation_id = d.id
            GROUP BY d.id, d.name
            ORDER BY ${orderBy}`
        )
      : await query(`SELECT id, name FROM designations ORDER BY ${orderByPlain}`);
    return Response.json({ designations }, { status: 200 });
  } catch (error) {
    console.error("Error fetching designations:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { name } = await req.json();

    if (!name) {
      return Response.json({ message: "Name is required" }, { status: 400 });
    }

    const res = await query("INSERT INTO designations (name) VALUES (?)", [name]);

    return Response.json({ message: "Designation added successfully", id: res.insertId }, { status: 201 });
  } catch (error) {
    console.error("Error adding designation:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
