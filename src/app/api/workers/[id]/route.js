import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, canManageWorkers } from "@/lib/permissions";
import { query } from "@/lib/db";
import { resolvePrimaryDesignationId } from "@/lib/designations";
import { phoneKey, last10Sql } from "@/lib/phone";

export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canManageWorkers(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const [worker] = await query(
      `SELECT w.*, ld.name AS district_name, la.name AS assembly_name, lz.name AS zone_name,
              lls.name AS lok_sabha_name, lw.name AS ward_name, lb.name AS booth_name
         FROM workers w
         LEFT JOIN locations ld ON ld.id = w.district_id
         LEFT JOIN locations la ON la.id = w.assembly_id
         LEFT JOIN locations lz ON lz.id = w.zone_id
         LEFT JOIN locations lls ON lls.id = w.lok_sabha_id
         LEFT JOIN locations lw ON lw.id = w.ward_id
         LEFT JOIN locations lb ON lb.id = w.booth_id
        WHERE w.id = ?`,
      [id]
    );
    if (!worker) return NextResponse.json({ message: "Not found" }, { status: 404 });

    const teams = await query(
      `SELECT t.id, t.name, t.level, tm.role_in_team
         FROM team_members tm JOIN teams t ON t.id = tm.team_id
        WHERE tm.worker_id = ?`,
      [id]
    );
    const badges = await query(
      `SELECT b.name, b.icon, b.color, wb.awarded_at
         FROM worker_badges wb JOIN badges b ON b.id = wb.badge_id
        WHERE wb.worker_id = ?`,
      [id]
    );
    return NextResponse.json({ worker, teams, badges });
  } catch (err) {
    console.error("worker GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    // Callers update worker details too; deletion below stays admin-only.
    if (!session || !canManageWorkers(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const d = await req.json();

    // One mobile per worker — block updates that would collide with another record.
    if (d.mobile) {
      // Compare on the last 10 digits, normalized in JS. Nesting the bound
      // param inside REPLACE(?, …) makes MariaDB throw
      // ER_CANT_AGGREGATE_3COLLATIONS (param collation vs the column's), which
      // 500s worker edit on production.
      const mobileKey = String(d.mobile).replace(/\D/g, "").slice(-10);
      const [dup] = await query(
        `SELECT id, name FROM workers
          WHERE id != ? AND mobile IS NOT NULL
            AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(mobile, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10) = ?
          LIMIT 1`,
        [id, mobileKey]
      );
      if (dup) {
        return NextResponse.json(
          { message: `Another worker already uses this mobile number: ${dup.name} (ID ${dup.id}).` },
          { status: 409 }
        );
      }
    }

    // Remember the worker's current mobile so we can find the linked contact
    // even if the mobile is being changed in this edit.
    const beforeRows = await query("SELECT mobile FROM workers WHERE id = ?", [id]);
    const oldMobile = beforeRows[0]?.mobile || null;

    const fields = ["name","mobile","photo_url","address","zone_id","lok_sabha_id","district_id","assembly_id","ward_id","booth_id","position","skills","status","activity_score"];
    const sets = [], vals = [];
    for (const f of fields) {
      if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    }
    if (!sets.length) return NextResponse.json({ message: "No fields" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE workers SET ${sets.join(", ")} WHERE id = ?`, vals);

    // Keep the linked Contact in sync (same person, matched by phone). Update
    // name/phone/address/location + the mapped designation so the Contacts page
    // shows the same info. Don't touch caller assignment / completion status.
    try {
      const newMobile = ("mobile" in d)
        ? (d.mobile ? String(d.mobile).trim().replace(/[^\d+]/g, "") : null)
        : oldMobile;
      const matchKey = phoneKey(oldMobile || newMobile);
      if (matchKey) {
        const [existing] = await query(
          `SELECT id FROM contacts WHERE phone_number IS NOT NULL AND ${last10Sql("phone_number")} = ? LIMIT 1`,
          [matchKey]
        );
        const designationId = ("position" in d) ? await resolvePrimaryDesignationId(d.position) : undefined;
        const cSets = [], cVals = [];
        if ("name" in d)         { cSets.push("person_name = ?"); cVals.push(d.name); }
        if (newMobile)           { cSets.push("phone_number = ?"); cVals.push(newMobile); }
        if ("address" in d)      { cSets.push("address = ?"); cVals.push(d.address || null); }
        if ("district_id" in d)  { cSets.push("district_id = ?"); cVals.push(d.district_id || null); }
        if ("assembly_id" in d)  { cSets.push("assembly_id = ?"); cVals.push(d.assembly_id || null); }
        if ("ward_id" in d)      { cSets.push("ward_id = ?"); cVals.push(d.ward_id || null); }
        if ("booth_id" in d)     { cSets.push("booth_id = ?"); cVals.push(d.booth_id || null); }
        if (designationId !== undefined) { cSets.push("designation_id = ?"); cVals.push(designationId); }

        if (existing) {
          if (cSets.length) { cVals.push(existing.id); await query(`UPDATE contacts SET ${cSets.join(", ")} WHERE id = ?`, cVals); }
        } else if (newMobile) {
          // No contact yet (e.g. a worker created before auto-sync) → create one.
          await query(
            `INSERT INTO contacts (person_name, phone_number, address, designation_id, district_id, assembly_id, ward_id, booth_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [d.name ?? null, newMobile, d.address || null, designationId ?? null,
             d.district_id || null, d.assembly_id || null, d.ward_id || null, d.booth_id || null]
          );
        }
      }
    } catch (e) {
      if (e.code !== "ER_DUP_ENTRY") console.error("worker->contact sync error:", e);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("worker PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    await query("DELETE FROM workers WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("worker DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
