import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { ensureProjectsSchema, projectsGate, parseId, validDate, PROJECT_SELECT } from "@/lib/projectsModule";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// GET one project with its full follow-up history (newest first by SAVED timestamp).
export async function GET(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    const denied = await projectsGate(session);
    if (denied) return denied;
    const id = parseId((await params).id);
    if (!id) return NextResponse.json({ message: "Invalid project." }, { status: 400 });
    await ensureProjectsSchema();
    const [project] = await query(`${PROJECT_SELECT} WHERE p.id = ?`, [id]);
    if (!project) return NextResponse.json({ message: "Project not found." }, { status: 404 });
    const history = await query(
      `SELECT f.id, f.project_type, f.remark, DATE_FORMAT(f.created_at,'%Y-%m-%d %H:%i:%s') AS created_at, st.name AS status_name, sg.name AS stage_name,
              DATE_FORMAT(f.next_followup_date,'%Y-%m-%d') AS next_followup_date, f.next_followup_remark, u.username AS by_name
         FROM pj_followups f LEFT JOIN pj_statuses st ON st.id = f.status_id LEFT JOIN pj_stages sg ON sg.id = f.stage_id LEFT JOIN users u ON u.id = f.created_by
        WHERE f.project_id = ? ORDER BY f.created_at DESC, f.id DESC`, [id]);
    return NextResponse.json({ project, history }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { console.error("project GET:", e); return NextResponse.json({ message: "Internal server error" }, { status: 500 }); }
}

// PUT: edit name/description and the Next Follow-up. Type, status, stage and the history are untouched here.
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    const denied = await projectsGate(session);
    if (denied) return denied;
    const id = parseId((await params).id);
    if (!id) return NextResponse.json({ message: "Invalid project." }, { status: 400 });
    const d = await req.json().catch(() => ({}));
    await ensureProjectsSchema();
    const sets = [], vals = [];
    if ("name" in d) { const n = String(d.name || "").trim().slice(0, 255); if (!n) return NextResponse.json({ message: "Enter the project name." }, { status: 400 }); sets.push("name = ?"); vals.push(n); }
    if ("description" in d) { sets.push("description = ?"); vals.push(String(d.description || "").trim().slice(0, 4000) || null); }
    if ("next_followup_date" in d) {
      if (d.next_followup_date && !validDate(d.next_followup_date)) return NextResponse.json({ message: "Enter a valid Next Follow-up date." }, { status: 400 });
      sets.push("next_followup_date = ?"); vals.push(d.next_followup_date || null);
    }
    if ("next_followup_remark" in d) { sets.push("next_followup_remark = ?"); vals.push(String(d.next_followup_remark || "").trim().slice(0, 1000) || null); }
    if (!sets.length) return NextResponse.json({ message: "Nothing to update." }, { status: 400 });
    const r = await query(`UPDATE pj_projects SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
    if (!r.affectedRows) return NextResponse.json({ message: "Project not found." }, { status: 404 });
    logAudit(session, { action: "project.update", entityType: "project", entityId: String(id), details: Object.keys(d) }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) { console.error("project PUT:", e); return NextResponse.json({ message: "Internal server error" }, { status: 500 }); }
}
