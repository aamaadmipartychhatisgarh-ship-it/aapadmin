import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { resolveActingUserId } from "@/lib/actAs";
import { updatePhonePickedOption } from "@/lib/unfilteredContacts";

// Change the Active / Not Active option of one of the acting caller's own saved Phone Picked calls.
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_calls", session && isCaller(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { userId } = await resolveActingUserId(session);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const r = await updatePhonePickedOption({ id, callerId: userId, option: body.option });
    return NextResponse.json({ message: r.message, option: r.option || null }, { status: r.status });
  } catch (err) {
    console.error("unfiltered-calls phone-picked error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
