import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { queryStatusManagement, statusOptions } from "@/lib/statusManagement";
import { STATUS_SOURCES } from "@/lib/contactSource";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET /api/admin/status-management — the consolidated Wrong Number / Not Interested / 10+ Switched Off / 10+ Incoming Off list.
// ?status=<status label>  ?source=contact_page|registration|unfiltered_calls  ?search ?zone_id ?lok_sabha_id ?district_id ?assembly_id
// ?caller ?assignment=assigned|unassigned ?reason ?designation_id ?date_from ?date_to ?page ?page_size ?sort=recent|name
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
    const r = await queryStatusManagement(session, sp);
    const { status, ...rest } = r;
    if (status !== 200) return NextResponse.json({ message: rest.message }, { status, headers: NO_STORE });
    return NextResponse.json({ ...rest, status_options: await statusOptions(), source_options: STATUS_SOURCES }, { headers: NO_STORE });
  } catch (err) {
    console.error("status-management GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
