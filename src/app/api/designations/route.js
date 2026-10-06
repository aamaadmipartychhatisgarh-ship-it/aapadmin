import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { notWrongNumberClause, notPendingClause } from "@/lib/contactExtras";
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
    // Ensures the `rank` column exists and runs the one-time global-rank backfill so
    // ranks are populated on first read. Self-guarded (swallows its own errors) and
    // module-cached, so it never 500s the list and only does real work once.
    await ensureWingSchema();
    const hasSortOrder =
      (await query("SHOW COLUMNS FROM designations LIKE 'sort_order'").catch(() => [])).length > 0;
    const hasWing = (await query("SHOW COLUMNS FROM designations LIKE 'wing'").catch(() => [])).length > 0;
    const hasRank = (await query("SHOW COLUMNS FROM designations LIKE 'rank'").catch(() => [])).length > 0;
    // GLOBAL Rank is the primary order (1,2,3… across the whole master); sort_order
    // and name are only tie-breakers/fallbacks. `rank` is reserved → back-quoted.
    const rankLead = (a) => (hasRank ? `(${a}\`rank\` IS NULL), ${a}\`rank\` ASC, ` : "");
    const orderBy = hasSortOrder
      ? `${rankLead("d.")}(d.sort_order IS NULL), d.sort_order ASC, d.name ASC`
      : `${rankLead("d.")}d.name ASC`;
    const orderByPlain = hasSortOrder
      ? `${rankLead("")}(sort_order IS NULL), sort_order ASC, name ASC`
      : `${rankLead("")}name ASC`;
    const wingColD = hasWing ? "d.wing" : "NULL AS wing";
    const wingCol = hasWing ? "wing" : "NULL AS wing";
    const sortColD = hasSortOrder ? "d.sort_order" : "NULL AS sort_order";
    const sortCol = hasSortOrder ? "sort_order" : "NULL AS sort_order";
    // The designation's global Rank, surfaced to the client (1-based). NULL until the
    // backfill/admin sets it.
    const rankColD = hasRank ? "d.`rank` AS `rank`" : "NULL AS `rank`";
    const rankCol = hasRank ? "`rank`" : "NULL AS `rank`";

    const designations = withStats
      ? await query(
          `SELECT d.id, d.name, d.level, ${wingColD}, ${sortColD}, ${rankColD}, COUNT(c.id) AS contact_count
             FROM designations d
             LEFT JOIN contacts c ON c.designation_id = d.id${await notWrongNumberClause("c")}${await notPendingClause("c")}
            GROUP BY d.id, d.name, d.level, ${hasWing ? "d.wing" : "d.id"}${hasSortOrder ? ", d.sort_order" : ""}${hasRank ? ", d.`rank`" : ""}
            ORDER BY ${orderBy}`
        )
      : await query(`SELECT id, name, level, ${wingCol}, ${sortCol}, ${rankCol} FROM designations ORDER BY ${orderByPlain}`);
    return Response.json({ designations }, { status: 200 });
  } catch (error) {
    console.error("Error fetching designations:", error);
    return Response.json({ message: "Internal server error", detail: error?.sqlMessage || error?.message || null }, { status: 500 });
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

    // Self-contained, lightweight schema ensure for exactly the columns this INSERT
    // uses. Each ALTER is guarded on its own, so one failing can't block the others
    // or the create. We deliberately DON'T call the heavy ensureWingSchema() here
    // (wing seeding + per-wing generation + rank backfill): the create doesn't need
    // it, and on a large/locked table that work could stall or fail and take the
    // add down with it. After this, the INSERT/UPDATE is built from the columns that
    // ACTUALLY exist, so a still-missing column degrades gracefully instead of
    // throwing "Unknown column" and 500-ing the whole request.
    const detectCols = async () => {
      const rows = await query("SHOW COLUMNS FROM designations").catch(() => []);
      return new Set(rows.map((c) => c.Field));
    };
    let cols = await detectCols();
    const WANT = [
      ["wing", "VARCHAR(120) NULL"],
      ["sort_order", "INT NULL"],
      ["enabled", "TINYINT NOT NULL DEFAULT 1"],
      ["rank", "INT NULL"], // GLOBAL designation order (the ALTER back-quotes the name)
    ];
    let altered = false;
    for (const [col, def] of WANT) {
      if (!cols.has(col)) {
        try {
          await query(`ALTER TABLE designations ADD COLUMN \`${col}\` ${def}`);
          altered = true;
        } catch (e) {
          console.error(`[designations] add column ${col}:`, e?.sqlMessage || e?.message || e);
        }
      }
    }
    if (altered) cols = await detectCols();
    const hasLevelCol = cols.has("level");
    const hasWingCol = cols.has("wing");
    const hasSortCol = cols.has("sort_order");
    const hasEnabledCol = cols.has("enabled");

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
          const sets = [];
          const args = [];
          if (hasLevelCol) { sets.push("level = ?"); args.push(level); }
          if (hasWingCol) { sets.push("wing = ?"); args.push(wing); }
          if (sets.length) {
            // eslint-disable-next-line no-await-in-loop
            await query(`UPDATE designations SET ${sets.join(", ")} WHERE id = ?`, [...args, existing.id]);
          }
          reused++;
          continue;
        }
        // Next order value in this (level, wing) group, when the column exists.
        let nextSort = null;
        if (hasSortCol) {
          // eslint-disable-next-line no-await-in-loop
          const [{ n }] = await query(
            `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM designations WHERE ${hasLevelCol ? "level = ?" : "1=1"}${hasWingCol ? " AND (wing <=> ?)" : ""}`,
            [...(hasLevelCol ? [level] : []), ...(hasWingCol ? [wing] : [])]
          );
          nextSort = n;
        }
        const insCols = ["name"];
        const insArgs = [composed];
        if (hasLevelCol) { insCols.push("level"); insArgs.push(level); }
        if (hasWingCol) { insCols.push("wing"); insArgs.push(wing); }
        if (hasSortCol) { insCols.push("sort_order"); insArgs.push(nextSort); }
        if (hasEnabledCol) { insCols.push("enabled"); insArgs.push(1); }
        // eslint-disable-next-line no-await-in-loop
        const res = await query(
          `INSERT INTO designations (${insCols.map((c) => `\`${c}\``).join(", ")}) VALUES (${insCols.map(() => "?").join(", ")})`,
          insArgs
        );
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
    return Response.json({ message: "Internal server error", detail: error?.sqlMessage || error?.message || null }, { status: 500 });
  }
}
