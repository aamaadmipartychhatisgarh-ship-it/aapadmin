import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { ensureDesignationLevelColumn, isValidDesignationLevel } from "@/lib/designationLevels";
import { ensureWingSchema, designationHasAssignments } from "@/lib/wingDesignations";
import { composeDesignationName, deriveDesignationBase } from "@/lib/designationName";
import { logMasterDataChange } from "@/lib/audit";

// POST /api/designations/[id]/wings  { name?, level?, wings: [wingName, ...] }
//
// Sets the full set of Wings a designation is configured for, at one level. The
// designation is stored as one row per (level, wing); this call makes those
// sibling rows (same base name + level) match the selected wings exactly:
//  - a row is created for each selected wing that has none (appended to that
//    (level, wing) group's order), reusing an identically-named row if present;
//  - a sibling row for a DESELECTED wing is deleted ONLY when it has no people
//    assigned — an occupied position is kept (existing worker data is never lost)
//    and reported back so the UI can explain why it stayed.
// This reuses the existing `designations.wing` column and row model — no parallel
// junction table — so every wing-aware query keeps working unchanged.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "master_data", session && isAdmin(session)))) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    await ensureDesignationLevelColumn(query);
    await ensureWingSchema();

    const body = await req.json().catch(() => ({}));
    const [current] = await query("SELECT id, name, level, wing FROM designations WHERE id = ?", [id]);
    if (!current) return Response.json({ message: "Designation not found" }, { status: 404 });

    const level = (typeof body?.level === "string" && body.level.trim()) ? body.level.trim() : (current.level || null);
    if (!level || !isValidDesignationLevel(level)) {
      return Response.json({ message: "A valid Level is required" }, { status: 400 });
    }

    // Authoritative wing names (admin may have added wings) for base derivation.
    const wingRows = await query("SELECT name FROM wings");
    const wingNames = wingRows.map((w) => w.name);

    const selected = Array.isArray(body?.wings)
      ? [...new Set(body.wings.map((w) => String(w || "").trim()).filter(Boolean))]
      : [];

    // The group is identified by the CURRENT row's base (so a rename renames the
    // existing rows in place and never orphans them), while newBase is what every
    // row in the group is renamed to.
    const oldBase = deriveDesignationBase(current.name, current.level || level, wingNames);
    const newBase = (typeof body?.name === "string" && body.name.trim())
      ? deriveDesignationBase(body.name.trim(), level, wingNames)
      : oldBase;
    if (!newBase) return Response.json({ message: "Designation name is required" }, { status: 400 });

    // Sibling rows = same (current) base + same level, across any wing.
    const levelRows = await query("SELECT id, name, wing FROM designations WHERE level = ?", [level]);
    const siblings = levelRows.filter(
      (r) => deriveDesignationBase(r.name, level, wingNames).toLowerCase() === oldBase.toLowerCase()
    );
    const siblingByWing = new Map(siblings.map((s) => [s.wing == null ? "" : String(s.wing), s]));

    // No wing selected → a single plain (no-wing) designation.
    const wantWings = selected.length ? selected : [null];

    const created = [];
    for (const wing of wantWings) {
      const wkey = wing == null ? "" : String(wing);
      const composed = composeDesignationName(level, newBase, wing);
      const sib = siblingByWing.get(wkey);
      if (sib) {
        // Rename/retag the EXISTING row in place — keeps its id, order & assignments.
        // eslint-disable-next-line no-await-in-loop
        await query("UPDATE designations SET name = ?, level = ?, wing = ? WHERE id = ?", [composed, level, wing, sib.id]);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const [exists] = await query("SELECT id FROM designations WHERE name = ? LIMIT 1", [composed]);
      if (exists) {
        // eslint-disable-next-line no-await-in-loop
        await query("UPDATE designations SET level = ?, wing = ? WHERE id = ?", [level, wing, exists.id]);
      } else {
        // eslint-disable-next-line no-await-in-loop
        const [{ n }] = await query(
          "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM designations WHERE level = ? AND (wing <=> ?)",
          [level, wing]
        );
        // eslint-disable-next-line no-await-in-loop
        const res = await query(
          "INSERT INTO designations (name, level, wing, sort_order, enabled) VALUES (?, ?, ?, ?, 1)",
          [composed, level, wing, n]
        );
        created.push(res.insertId);
      }
    }

    const wantSet = new Set(wantWings.map((w) => (w == null ? "" : String(w))));
    const removed = [];
    const keptAssigned = [];
    for (const sib of siblings) {
      const wkey = sib.wing == null ? "" : String(sib.wing);
      if (wantSet.has(wkey)) continue; // still selected
      // eslint-disable-next-line no-await-in-loop
      if (await designationHasAssignments(sib.id)) { keptAssigned.push(sib.name); continue; }
      // eslint-disable-next-line no-await-in-loop
      await query("UPDATE contacts SET designation_id = NULL WHERE designation_id = ?", [sib.id]);
      // eslint-disable-next-line no-await-in-loop
      await query("DELETE FROM designations WHERE id = ?", [sib.id]);
      removed.push(sib.id);
    }

    await logMasterDataChange(session, {
      req, master: "designation", action: "Updated Wings", recordId: id, recordName: newBase,
      after: { level, wings: selected, created: created.length, removed: removed.length, keptAssigned: keptAssigned.length },
    });

    const message = keptAssigned.length
      ? `Wings updated. ${keptAssigned.length} wing(s) could not be removed because people are assigned: ${keptAssigned.join(", ")}.`
      : "Wings updated.";
    return Response.json({ ok: true, base: newBase, level, created, removed, keptAssigned, message });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return Response.json({ message: "A designation with this name already exists" }, { status: 409 });
    }
    console.error("designation wings POST error:", error);
    return Response.json({ message: "Internal server error", detail: error?.sqlMessage || error?.message || null }, { status: 500 });
  }
}
