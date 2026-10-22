import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { myUnfilteredCalls } from "@/lib/unfilteredContacts";

const NO_STORE = { "Cache-Control": "no-store" };

// The signed-in caller's own assigned Unfiltered Calls (?view=pending|completed|all).
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_calls", session && isCaller(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const view = new URL(req.url).searchParams.get("view") || "pending";
    return NextResponse.json(await myUnfilteredCalls(session.user.id, { view }), { headers: NO_STORE });
  } catch (err) {
    console.error("unfiltered-calls GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
