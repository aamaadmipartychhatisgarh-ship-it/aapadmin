import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin, canManageWorkers } from "@/lib/permissions";
import { query } from "@/lib/db";

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
      const [dup] = await query(
        `SELECT id, name FROM workers
          WHERE id != ? AND mobile IS NOT NULL
            AND RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', ''), 10) = RIGHT(REGEXP_REPLACE(?, '[^0-9]', ''), 10)
          LIMIT 1`,
        [id, String(d.mobile)]
      );
      if (dup) {
        return NextResponse.json(
          { message: `Another worker already uses this mobile number: ${dup.name} (ID ${dup.id}).` },
          { status: 409 }
        );
      }
    }

    const fields = ["name","mobile","photo_url","address","zone_id","lok_sabha_id","district_id","assembly_id","ward_id","booth_id","position","skills","status","activity_score"];
    const sets = [], vals = [];
    for (const f of fields) {
      if (f in d) { sets.push(`${f} = ?`); vals.push(d[f] === "" ? null : d[f]); }
    }
    if (!sets.length) return NextResponse.json({ message: "No fields" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE workers SET ${sets.join(", ")} WHERE id = ?`, vals);
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
