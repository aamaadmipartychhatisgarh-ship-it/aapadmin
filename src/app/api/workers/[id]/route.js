import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, canManageWorkers } from "@/lib/permissions";
import { query, getPool } from "@/lib/db";
import { syncWorkerToContact } from "@/lib/workerSync";
import { recomputeWorkerStatus } from "@/lib/workerStatus";
import { deleteLocalUpload } from "@/lib/uploadCleanup";
import { logAudit } from "@/lib/audit";

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

    // Note: "status" is intentionally excluded — it's derived from profile
    // completeness (recomputed below), never set directly by the client.
    const fields = ["name","mobile","photo_url","address","zone_id","lok_sabha_id","district_id","assembly_id","ward_id","booth_id","position","skills","activity_score","membership_no","member_since","membership_status","valid_till"];
    const sets = [], vals = [];
    for (const f of fields) {
      if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    }
    if (!sets.length) return NextResponse.json({ message: "No fields" }, { status: 400 });

    // Apply the worker edit and mirror it onto the linked contact atomically
    // (matched by worker_id, falling back to phone; creates + links a contact if
    // none). Keeps name/phone/address/geography/designation in step across the
    // Workers, Contacts, calling queue and reports.
    const pool = getPool();
    const conn = await pool.getConnection();
    let updated;
    let oldPhoto = null;
    try {
      await conn.beginTransaction();
      if ("photo_url" in d) {
        const [[prev]] = await conn.query("SELECT photo_url FROM workers WHERE id = ?", [id]);
        oldPhoto = prev?.photo_url || null;
      }
      vals.push(id);
      await conn.query(`UPDATE workers SET ${sets.join(", ")} WHERE id = ?`, vals);
      // Recompute status from the merged row (Active only if all mandatory
      // fields are now filled; Pending otherwise) before mirroring to contacts.
      await recomputeWorkerStatus(conn, id);
      await syncWorkerToContact(conn, id);
      const [rows] = await conn.query("SELECT * FROM workers WHERE id = ?", [id]);
      updated = rows[0];
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    // Clean up the replaced/removed photo file once the change is committed.
    if (oldPhoto && oldPhoto !== (updated?.photo_url || null)) await deleteLocalUpload(oldPhoto);

    return NextResponse.json({ ok: true, worker: updated });
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
    const [w] = await query("SELECT name, mobile FROM workers WHERE id = ?", [id]);
    await query("DELETE FROM workers WHERE id = ?", [id]);
    await logAudit(session, { action: "worker.delete", entityType: "worker", entityId: id, details: w || null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("worker DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
