import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { MAIN_WING_FILTER } from "@/lib/vacancyDashboard";
import { buildVacancyTree } from "@/lib/vacancyTree";

// GET /api/vacancies/tree — the Designation Vacancies Tree Map (State -> Lok Sabha -> District -> Assembly),
// built from the same live dataset as /api/vacancies. Same gate (the "vacancies" page key) and the same
// territory scope, so a user only ever sees the posts — and proposed people — of the areas they may see.
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
    const data = await buildVacancyTree(session, {
      // Same default as the list: the Main Wing; "wing=" (empty) = All Wings.
      wing: searchParams.has("wing") ? searchParams.get("wing") : MAIN_WING_FILTER,
    });
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (err) {
    console.error("[vacancies/tree] GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
