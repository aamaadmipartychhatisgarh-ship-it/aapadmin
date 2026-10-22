import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { completeUnfilteredCall } from "@/lib/unfilteredContacts";

// Mark one of the caller's own Unfiltered Calls completed (with a call status).
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_calls", session && isCaller(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const r = await completeUnfilteredCall({ id, userId: session.user.id, statusId: body.status_id, notes: body.notes });
    return NextResponse.json({ message: r.message }, { status: r.status });
  } catch (err) {
    console.error("unfiltered-calls complete error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
