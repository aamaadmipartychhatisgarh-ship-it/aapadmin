import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isCaller } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { findWorkersByPhone } from "@/lib/complaintWorker";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET /api/complaints/worker-lookup?phone=… — the Worker (contact) behind a mobile
// number and the Assembly mapped to it, for the complaint form. Returns only what the
// form shows (name, mobile, assembly, district); `status` tells the form whether the
// match is unique, ambiguous (caller must choose) or absent. Same access as the
// complaints page itself.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "complaints", session && (isOversight(session) || isCaller(session))))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const phone = new URL(req.url).searchParams.get("phone") || "";
    const r = await findWorkersByPhone(phone);
    return NextResponse.json({
      status: r.status,
      assembly: r.assembly,
      workers: r.matches.map((m) => ({
        id: m.id, name: m.person_name, phone: m.phone_number,
        assembly_id: m.assembly_id ?? null, assembly_name: m.assembly_name ?? null,
        district_name: m.district_name ?? null,
      })),
    }, { headers: NO_STORE });
  } catch (err) {
    console.error("complaints worker-lookup error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
