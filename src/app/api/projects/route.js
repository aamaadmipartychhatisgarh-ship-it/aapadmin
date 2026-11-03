import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { ensureProjectsSchema, projectsGate, PROJECT_TYPES, PROJECT_SELECT } from "@/lib/projectsModule";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    const denied = await projectsGate(session);
    if (denied) return denied;
    await ensureProjectsSchema();
    const type = new URL(req.url).searchParams.get("type");
    const where = PROJECT_TYPES.includes(type) ? "WHERE p.project_type = ?" : "";
    const rows = await query(`${PROJECT_SELECT} ${where} ORDER BY p.id DESC LIMIT 1000`, where ? [type] : []);
    return NextResponse.json({ projects: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { console.error("projects GET:", e); return NextResponse.json({ message: "Internal server error" }, { status: 500 }); }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    const denied = await projectsGate(session);
    if (denied) return denied;
    const d = await req.json().catch(() => ({}));
    const name = String(d.name || "").trim().slice(0, 255);
    if (!PROJECT_TYPES.includes(d.project_type)) return NextResponse.json({ message: "Choose Department Project or MLA Fund Project." }, { status: 400 });
    if (!name) return NextResponse.json({ message: "Enter the project name." }, { status: 400 });
    await ensureProjectsSchema();
    const r = await query("INSERT INTO pj_projects (project_type, name, description, created_by) VALUES (?,?,?,?)", [d.project_type, name, String(d.description || "").trim().slice(0, 4000) || null, session.user.id]);
    logAudit(session, { action: "project.create", entityType: "project", entityId: String(r.insertId), details: { project_type: d.project_type, name } }).catch(() => {});
    return NextResponse.json({ ok: true, id: r.insertId }, { status: 201 });
  } catch (e) { console.error("projects POST:", e); return NextResponse.json({ message: "Internal server error" }, { status: 500 }); }
}
