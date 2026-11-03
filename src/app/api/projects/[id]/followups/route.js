import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { ensureProjectsSchema, projectsGate, parseId, validDate } from "@/lib/projectsModule";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// POST a follow-up: { status_id, stage_id, remark, next_followup_date?, next_followup_remark?, submission_key }.
//  - The stage must belong to THIS project's type (Department vs MLA Fund lists never mix).
//  - A status with skips_stage (No Budget) ignores any stage: none is required, saved or changed; only the Remark is used.
//  - The follow-up row is append-only and stamped by the database (DATETIME(3)); the project's current status/stage
//    (and Next Follow-up when sent) are updated in the SAME transaction. A repeated submission_key is a no-op.
export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  const denied = await projectsGate(session);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ message: "Invalid project." }, { status: 400 });
  const d = await req.json().catch(() => ({}));
  const remark = String(d.remark || "").trim().slice(0, 2000);
  const statusId = parseId(d.status_id);
  const key = d.submission_key ? String(d.submission_key).slice(0, 64) : null;
  if (!statusId) return NextResponse.json({ message: "Select a status." }, { status: 400 });
  if (!remark) return NextResponse.json({ message: "Enter the remark." }, { status: 400 });
  const hasNext = "next_followup_date" in d || "next_followup_remark" in d;
  if (d.next_followup_date && !validDate(d.next_followup_date)) return NextResponse.json({ message: "Enter a valid Next Follow-up date." }, { status: 400 });
  await ensureProjectsSchema();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [[project]] = await conn.query("SELECT id, project_type FROM pj_projects WHERE id = ? FOR UPDATE", [id]);
    if (!project) { await conn.rollback(); return NextResponse.json({ message: "Project not found." }, { status: 404 }); }
    const [[status]] = await conn.query("SELECT id, name, skips_stage FROM pj_statuses WHERE id = ? AND is_active = 1", [statusId]);
    if (!status) { await conn.rollback(); return NextResponse.json({ message: "That status is not valid." }, { status: 400 }); }
    const noStage = Number(status.skips_stage) === 1;
    let stageId = null;
    if (!noStage) {
      stageId = parseId(d.stage_id);
      if (!stageId) { await conn.rollback(); return NextResponse.json({ message: "Select a stage." }, { status: 400 }); }
      const [[stage]] = await conn.query("SELECT id FROM pj_stages WHERE id = ? AND project_type = ? AND is_active = 1", [stageId, project.project_type]);
      if (!stage) { await conn.rollback(); return NextResponse.json({ message: "That stage does not belong to this project type." }, { status: 400 }); }
    }
    if (key) {
      const [[dup]] = await conn.query("SELECT id FROM pj_followups WHERE project_id = ? AND submission_key = ?", [id, key]);
      if (dup) { await conn.commit(); return NextResponse.json({ ok: true, id: dup.id, duplicate: true }); }
    }
    const nextDate = hasNext ? (d.next_followup_date || null) : null;
    const nextRemark = hasNext ? (String(d.next_followup_remark || "").trim().slice(0, 1000) || null) : null;
    const [ins] = await conn.query(
      `INSERT INTO pj_followups (project_id, project_type, status_id, stage_id, remark, next_followup_date, next_followup_remark, submission_key, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`, [id, project.project_type, statusId, stageId, remark, nextDate, nextRemark, key, session.user.id]);
    // Current state: status always; stage only when this status carries one (No Budget keeps the old stage).
    const sets = ["status_id = ?"], vals = [statusId];
    if (!noStage) { sets.push("stage_id = ?"); vals.push(stageId); }
    if (hasNext) { sets.push("next_followup_date = ?", "next_followup_remark = ?"); vals.push(nextDate, nextRemark); }
    await conn.query(`UPDATE pj_projects SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
    await conn.commit();
    logAudit(session, { action: "project.followup", entityType: "project", entityId: String(id), details: { followup_id: ins.insertId, status: status.name, stage_id: stageId } }).catch(() => {});
    return NextResponse.json({ ok: true, id: ins.insertId }, { status: 201 });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e?.code === "ER_DUP_ENTRY") return NextResponse.json({ ok: true, duplicate: true });
    console.error("project followup POST:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  } finally { conn.release(); }
}
