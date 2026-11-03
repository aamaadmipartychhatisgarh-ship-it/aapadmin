import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { ensureProjectsSchema, projectsGate } from "@/lib/projectsModule";

export const dynamic = "force-dynamic";

// The master data: statuses, and the stages of EACH project type (never mixed).
export async function GET() {
  const session = await getServerSession(authOptions);
  const denied = await projectsGate(session);
  if (denied) return denied;
  await ensureProjectsSchema();
  const statuses = await query("SELECT id, name, skips_stage FROM pj_statuses WHERE is_active = 1 ORDER BY sort_order, id");
  const stages = await query("SELECT id, project_type, name FROM pj_stages WHERE is_active = 1 ORDER BY sort_order, id");
  return NextResponse.json({
    statuses: statuses.map((s) => ({ ...s, skips_stage: Number(s.skips_stage) === 1 })),
    stages: { department: stages.filter((s) => s.project_type === "department"), mla_fund: stages.filter((s) => s.project_type === "mla_fund") },
  }, { headers: { "Cache-Control": "no-store" } });
}
