import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { unfilteredActiveFollowupCounts, parseCountFilters } from "@/lib/unfilteredContacts";

const NO_STORE = { "Cache-Control": "no-store" };

// User-wise / Date-wise Active and Follow-up counts of the Unfiltered Contacts (read-only). Same access as the page itself.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const { searchParams } = new URL(req.url);
    const f = parseCountFilters({ user: searchParams.get("user"), date: searchParams.get("date") });
    if (f.bad) return NextResponse.json({ message: "Invalid user or date filter." }, { status: 400, headers: NO_STORE });
    return NextResponse.json(await unfilteredActiveFollowupCounts(f), { headers: NO_STORE });
  } catch (err) {
    console.error("unfiltered-contacts counts GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
