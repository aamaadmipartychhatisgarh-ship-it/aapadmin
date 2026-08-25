import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { ensureDesignationLevelColumn, isValidDesignationLevel } from "@/lib/designationLevels";

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
    await ensureDesignationLevelColumn(query); // PROMPT 13 — level column
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
          `SELECT d.id, d.name, d.level, COUNT(c.id) AS contact_count
             FROM designations d
             LEFT JOIN contacts c ON c.designation_id = d.id${await notWrongNumberClause("c")}
            GROUP BY d.id, d.name, d.level
            ORDER BY ${orderBy}`
        )
      : await query(`SELECT id, name, level FROM designations ORDER BY ${orderByPlain}`);
    return Response.json({ designations }, { status: 200 });
  } catch (error) {
    console.error("Error fetching designations:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "master_data", session && isAdmin(session)))) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const level = typeof body?.level === "string" ? body.level.trim() : "";

    // PROMPT 13 — both Level and Designation Name are mandatory.
    if (!name) {
      return Response.json({ message: "Designation name is required" }, { status: 400 });
    }
    if (!level) {
      return Response.json({ message: "Level is required" }, { status: 400 });
    }
    if (!isValidDesignationLevel(level)) {
      return Response.json({ message: "Invalid level" }, { status: 400 });
    }

    await ensureDesignationLevelColumn(query);
    // The `name` column is globally UNIQUE, so a duplicate designation name is
    // rejected by the DB (ER_DUP_ENTRY) — no accidental dupes at any level.
    const res = await query("INSERT INTO designations (name, level) VALUES (?, ?)", [name, level]);

    return Response.json({ message: "Designation added successfully", id: res.insertId }, { status: 201 });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return Response.json({ message: "A designation with this name already exists" }, { status: 409 });
    }
    console.error("Error adding designation:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
