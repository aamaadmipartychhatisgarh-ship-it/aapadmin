import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { buildVacancyDataset } from "@/lib/vacancyDashboard";

// GET /api/vacancies — the Designation Vacancy dashboard dataset (summary cards,
// vacancy table, hierarchy drill-down, filter option lists). Everything is
// computed LIVE from the organizational designation data + real hierarchy, so a
// filled position stops appearing automatically. Gated by the "vacancies" page key
// (Super Admin / Admin); the underlying detection also applies the caller's
// territory scope, so unrelated areas are never exposed.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!(await pageAllowed(session, "vacancies", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    }
    const { searchParams } = new URL(req.url);
    const data = await buildVacancyDataset(session, {
      level: searchParams.get("level"),
      lokSabhaId: searchParams.get("lok_sabha_id"),
      districtId: searchParams.get("district_id"),
      assemblyId: searchParams.get("assembly_id"),
      blockId: searchParams.get("block_id"),
      designationId: searchParams.get("designation_id"),
      status: searchParams.get("status"),
      reminderStatus: searchParams.get("reminder_status"),
      responsibleId: searchParams.get("responsible_id"),
    });
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (err) {
    console.error("[vacancies] GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
