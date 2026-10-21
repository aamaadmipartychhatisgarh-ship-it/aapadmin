import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { buildWingVacancyDataset } from "@/lib/wingVacancies";

// GET /api/vacancies/wings — Wing Designation Vacancies (President / Prabhari /
// General Secretary per Wing × State → Lok Sabha → District → Assembly), computed
// LIVE from the Wing master, Designation Master and Contacts. Same gate as the main
// vacancy dashboard (the "vacancies" page key) and the same territory scope.
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
    const data = await buildWingVacancyDataset(session, {
      wing: searchParams.get("wing"),
      level: searchParams.get("level"),
      role: searchParams.get("role"),
      lokSabhaId: searchParams.get("lok_sabha_id"),
      districtId: searchParams.get("district_id"),
      assemblyId: searchParams.get("assembly_id"),
      status: searchParams.get("status"),
    });
    // The Data check panel was removed from Designation Vacancies; its
    // mapping-problem lists are no longer served.
    delete data.data_quality;
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (err) {
    console.error("[vacancies/wings] GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
