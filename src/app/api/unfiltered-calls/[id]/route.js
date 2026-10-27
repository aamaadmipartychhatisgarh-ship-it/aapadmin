import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller, isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { resolveActingUserId } from "@/lib/actAs";
import { updateUnfilteredContact } from "@/lib/unfilteredContacts";

// Edit the details (Photo, Address, Zone, Lok Sabha, District, Assembly, Block) of one of the
// acting caller's own Unfiltered Calls. Only deliberately changed fields are saved.
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_calls", session && isCaller(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { userId } = await resolveActingUserId(session);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const r = await updateUnfilteredContact({ session, id, callerId: userId, data: body, canClear: isOversight(session) });
    const { status, ...rest } = r;
    return NextResponse.json(rest, { status });
  } catch (err) {
    console.error("unfiltered-calls update error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
