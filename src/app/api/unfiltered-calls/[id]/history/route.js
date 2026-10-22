import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { resolveActingUserId } from "@/lib/actAs";
import { unfilteredCallHistory } from "@/lib/unfilteredContacts";

// Previous attempts on one of the acting caller's own Unfiltered Calls.
export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_calls", session && isCaller(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { userId } = await resolveActingUserId(session);
    const { id } = await params;
    const history = await unfilteredCallHistory({ id, callerId: userId });
    if (!history) return NextResponse.json({ message: "This call is not assigned to you." }, { status: 404 });
    return NextResponse.json({ history }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("unfiltered-calls history error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
