import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { resolveActingUserId } from "@/lib/actAs";
import { logUnfilteredCall } from "@/lib/unfilteredContacts";

// Log a call disposition for one of the acting caller's own Unfiltered Calls.
// Saved to unfiltered_call_logs against the Unfiltered Contact (never `calls`).
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_calls", session && isCaller(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { userId } = await resolveActingUserId(session);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const r = await logUnfilteredCall({
      id, callerId: userId, loggedBy: session.user.id,
      statusId: body.status_id, remarks: body.remarks, durationSeconds: body.duration_seconds, sentiment: body.sentiment, wrongReason: body.wrong_number_reason,
    });
    return NextResponse.json({ message: r.message, completed: !!r.completed, contact_sync: r.contact_sync || null }, { status: r.status });
  } catch (err) {
    console.error("unfiltered-calls log error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
