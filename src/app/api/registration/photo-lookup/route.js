import { NextResponse } from "next/server";
import { requireRegistrationAccess, NO_STORE } from "@/lib/registrationGuard";
import { photoByMobile } from "@/lib/photoByMobile";

// Generate Link → automatic photo (§1). Given a mobile number, return the existing
// stored photo (and name) for that number so the admin never re-uploads it.
// Matched by mobile only; an unregistered number returns {} (no photo). Gated by
// the same registration access as the rest of the module.
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const { error } = await requireRegistrationAccess();
    if (error) return error;
    const mobile = new URL(req.url).searchParams.get("mobile") || "";
    const hit = await photoByMobile(mobile);
    return NextResponse.json(hit || {}, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] photo-lookup error:", e);
    return NextResponse.json({}, { headers: NO_STORE });
  }
}
