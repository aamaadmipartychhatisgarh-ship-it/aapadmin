import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { ensureInfluencerSchema } from "@/lib/influencerSchema";
import { findInfluencerByPhone } from "@/lib/influencerPhone";
import { influencerPhoneKey } from "@/lib/influencerColumns";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET /api/influencers/phone-check?phone=…&exclude_id=… → { duplicate: {id,name,phone} | null }
// Live pre-check for the Add/Edit form (the save itself re-checks on the server).
// exclude_id is the influencer being edited, so its own number is never a duplicate.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!(await userCanAccessPageKey(session, "influencers"))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    await ensureInfluencerSchema();
    const sp = new URL(req.url).searchParams;
    const phone = sp.get("phone") || "";
    if (!influencerPhoneKey(phone)) return NextResponse.json({ duplicate: null }, { headers: NO_STORE });
    const existing = await findInfluencerByPhone(phone, sp.get("exclude_id"));
    return NextResponse.json({ duplicate: existing ? { id: existing.id, name: existing.name, phone: existing.phone } : null }, { headers: NO_STORE });
  } catch (err) {
    console.error("[influencer] phone-check:", err?.sqlMessage || err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
