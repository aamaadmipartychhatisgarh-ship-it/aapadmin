import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isCaller } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { resolveActingUserId } from "@/lib/actAs";
import { myUnfilteredCalls, searchMyUnfilteredCalls } from "@/lib/unfilteredContacts";

const NO_STORE = { "Cache-Control": "no-store" };

// My Workspace → Unfiltered Calls: the acting caller's OWN assigned Unfiltered
// Contacts (?view=pending|completed) plus Assigned / Completed / Pending counts.
// The caller is always taken from the session (a Super Admin previewing a
// caller acts as that caller, exactly like the regular workspace endpoints) —
// never from the request, so no other caller's records can be listed.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_calls", session && isCaller(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const { userId } = await resolveActingUserId(session);
    const sp = new URL(req.url).searchParams;
    // ?phone=<digits, partial ok>: the caller's own records matching that number, in all three statuses at once.
    if (sp.has("phone")) {
      const r = await searchMyUnfilteredCalls(userId, sp.get("phone"));
      if (!r) return NextResponse.json({ message: "Enter at least 3 digits of the phone number." }, { status: 400, headers: NO_STORE });
      return NextResponse.json({ search: r }, { headers: NO_STORE });
    }
    const v = sp.get("view");
    const view = v === "completed" ? "completed" : v === "followups" ? "followups" : "pending";
    return NextResponse.json(await myUnfilteredCalls(userId, { view, date: sp.get("date") }), { headers: NO_STORE });
  } catch (err) {
    console.error("unfiltered-calls GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
