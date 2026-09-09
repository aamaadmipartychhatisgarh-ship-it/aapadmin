import { NextResponse } from "next/server";
import { requireRegistrationAccess, NO_STORE, parseRegFilters } from "@/lib/registrationGuard";
import { getPeoplePage } from "@/lib/registrationStats";

// The full registration list — "complete details of which worker added which
// person". Every row carries its collecting worker's name and User ID, so
// attribution reads straight off the table with no second look-up.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(req) {
  try {
    const { error } = await requireRegistrationAccess();
    if (error) return error;
    const { searchParams } = new URL(req.url);
    const data = await getPeoplePage({
      ...parseRegFilters(searchParams),
      sort: searchParams.get("sort") || "newest",
      page: parseInt(searchParams.get("page") || "1", 10) || 1,
      pageSize: parseInt(searchParams.get("pageSize") || "25", 10) || 25,
    });
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] people GET error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
