import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { fetchIncompleteDesignation, normalizeLevel } from "@/lib/incompleteDesignations";

export const dynamic = "force-dynamic";

// CONTACTS → INCOMPLETE DESIGNATION (Level & Designation-wise assignment).
// Params: level (state|zone|lok_sabha|district|assembly|block), optional
// designation_id, location_id, and status (all|filled|blank). Everything is
// computed live from the Designation Master + location hierarchy + assignments
// via the shared data layer — the very same function the PDF/Excel export uses,
// so exports always match the page. Returns the display rows + total/filled/blank
// counts + the dropdown lists (level designations & locations).
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const level = normalizeLevel(searchParams.get("level"));
    if (!level) return NextResponse.json({ message: "Invalid level." }, { status: 400 });

    const data = await fetchIncompleteDesignation(session, {
      level,
      designationId: parseInt(searchParams.get("designation_id"), 10),
      locationId: parseInt(searchParams.get("location_id"), 10),
      status: searchParams.get("status"),
      // Total-Assigned-Person drill-down (flattened, server-side paginated).
      view: searchParams.get("view"),
      page: parseInt(searchParams.get("page"), 10),
      pageSize: parseInt(searchParams.get("page_size"), 10),
    });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("contacts incomplete (level assignment) error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
