import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { notWrongNumberClause } from "@/lib/contactExtras";
import { ensureDesignationLevelColumn, isValidDesignationLevel, designationLevelLabel } from "@/lib/designationLevels";
import { ensureWingSchema } from "@/lib/wingDesignations";
import { logMasterDataChange } from "@/lib/audit";

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
    const hasWing = (await query("SHOW COLUMNS FROM designations LIKE 'wing'")).length > 0;
    const orderBy = hasSortOrder
      ? "(d.sort_order IS NULL), d.sort_order ASC, d.name ASC"
      : "d.name ASC";
    const orderByPlain = hasSortOrder
      ? "(sort_order IS NULL), sort_order ASC, name ASC"
      : "name ASC";
    const wingColD = hasWing ? "d.wing" : "NULL AS wing";
    const wingCol = hasWing ? "wing" : "NULL AS wing";

    const designations = withStats
      ? await query(
          `SELECT d.id, d.name, d.level, ${wingColD}, COUNT(c.id) AS contact_count
             FROM designations d
             LEFT JOIN contacts c ON c.designation_id = d.id${await notWrongNumberClause("c")}
            GROUP BY d.id, d.name, d.level, ${hasWing ? "d.wing" : "d.id"}
            ORDER BY ${orderBy}`
        )
      : await query(`SELECT id, name, level, ${wingCol} FROM designations ORDER BY ${orderByPlain}`);
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
    if (!name) {
      return Response.json({ message: "Designation name is required" }, { status: 400 });
    }

    // Multi-select mode: `levels` (array) and/or `wings` (array of stored wing
    // names). Falls back to the legacy single `level` field. For every selected
    // Level × Wing combination one designation is created in the Master, with the
    // configured order stored in sort_order (appended to that Level+Wing group).
    const levels = Array.isArray(body?.levels)
      ? body.levels.map((l) => String(l || "").trim()).filter(isValidDesignationLevel)
      : (body?.level && isValidDesignationLevel(String(body.level).trim()) ? [String(body.level).trim()] : []);
    if (!levels.length) {
      return Response.json({ message: "Select at least one valid Level" }, { status: 400 });
    }
    const rawWings = Array.isArray(body?.wings) ? body.wings.map((w) => String(w || "").trim()).filter(Boolean) : [];
    const wings = rawWings.length ? rawWings : [null]; // no wing selected → a plain designation
    // Prefix the level / append the wing only in multi mode, so legacy single-level
    // adds keep storing the name exactly as typed.
    const multi = levels.length > 1 || rawWings.length > 0;

    await ensureDesignationLevelColumn(query);
    await ensureWingSchema(); // guarantees the wing / sort_order / enabled columns exist

    const created = [];
    let reused = 0;
    for (const level of levels) {
      const levelLabel = designationLevelLabel(level) || level;
      for (const wing of wings) {
        let composed = name;
        if (multi && !composed.toLowerCase().startsWith(levelLabel.toLowerCase())) composed = `${levelLabel} ${composed}`;
        if (wing && wing !== "Main Organisation" && !composed.toLowerCase().includes(wing.toLowerCase())) composed = `${composed}, ${wing}`;
        // The name is globally UNIQUE: reuse any existing row (never a duplicate),
        // just (re)tagging its level + wing; otherwise insert appended to the group.
        // eslint-disable-next-line no-await-in-loop
        const [existing] = await query("SELECT id FROM designations WHERE name = ? LIMIT 1", [composed]);
        if (existing) {
          // eslint-disable-next-line no-await-in-loop
          await query("UPDATE designations SET level = ?, wing = ? WHERE id = ?", [level, wing, existing.id]);
          reused++;
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const [{ n }] = await query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM designations WHERE level = ? AND (wing <=> ?)", [level, wing]);
        // eslint-disable-next-line no-await-in-loop
        const res = await query("INSERT INTO designations (name, level, wing, sort_order, enabled) VALUES (?, ?, ?, ?, 1)", [composed, level, wing, n]);
        created.push({ id: res.insertId, name: composed, level, wing });
      }
    }

    await logMasterDataChange(session, {
      req, master: "designation", action: "Created", recordName: name,
      after: { levels, wings: rawWings, created: created.length, reused },
    });
    const first = created[0];
    return Response.json(
      { message: `Added ${created.length} designation(s)${reused ? `, updated ${reused}` : ""}.`, id: first?.id ?? null, created },
      { status: 201 }
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return Response.json({ message: "A designation with this name already exists" }, { status: 409 });
    }
    console.error("Error adding designation:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
