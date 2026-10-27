import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { resolveActingUserId } from "@/lib/actAs";
import { releaseUnfilteredCall } from "@/lib/unfilteredContacts";

// "Release (no log)" for an Unfiltered Call - the counterpart of /api/workspace/release for Regular Calls:
// the caller lets go of the call they are on WITHOUT logging a disposition. Nothing is written to the call,
// its history, remarks or assignment (exactly as the Regular release only drops the in-progress hold); the
// server just verifies the call is the acting caller's own pending call so a caller can never release
// somebody else's, and the call stays in their queue for a later attempt.
export async function POST(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_calls", session && isCaller(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { userId } = await resolveActingUserId(session);
    const { id } = await params;
    const r = await releaseUnfilteredCall({ id, callerId: userId });
    return NextResponse.json({ message: r.message, ok: r.status === 200 }, { status: r.status });
  } catch (err) {
    console.error("unfiltered-calls release error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
