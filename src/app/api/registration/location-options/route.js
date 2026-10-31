import { NextResponse } from "next/server";
import { requireRegistrationAccess, NO_STORE } from "@/lib/registrationGuard";
import { getLocationFilterOptions } from "@/lib/registrationStats";

// Lok Sabha / Assembly options (Master Data) for the Worker-wise Performance filters.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { error } = await requireRegistrationAccess();
    if (error) return error;
    return NextResponse.json(await getLocationFilterOptions(), { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] location-options GET error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
