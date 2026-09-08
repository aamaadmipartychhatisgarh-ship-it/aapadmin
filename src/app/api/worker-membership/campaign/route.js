import { NextResponse } from "next/server";
import { requireSuperAdmin, NO_STORE } from "@/lib/superAdminGuard";
import { getCurrentCampaign, listCampaigns, createCampaign } from "@/lib/campaign";

// Campaign period + password cycle. GET returns the current/previous/next
// campaign and the full history; POST creates a new period (optionally rotating,
// which closes the active one and issues a new password cycle without changing
// worker User IDs). Super-Admin only; POST is audit-logged.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET() {
  try {
    const { error } = await requireSuperAdmin();
    if (error) return error;
    const [current, history] = await Promise.all([getCurrentCampaign(), listCampaigns()]);
    return NextResponse.json({ ...current, history }, { headers: NO_STORE });
  } catch (err) {
    console.error("[membership] campaign GET error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req) {
  try {
    const { error, session } = await requireSuperAdmin();
    if (error) return error;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ message: "Invalid request body." }, { status: 400, headers: NO_STORE });
    const rotate = body.rotate === true || body.rotate === "1";
    const row = await createCampaign(session, body, { rotate });
    return NextResponse.json({ campaign: row }, { status: 201, headers: NO_STORE });
  } catch (err) {
    const msg = err?.message || "Internal server error";
    const bad = /required|valid/i.test(msg);
    console.error("[membership] campaign POST error:", err);
    return NextResponse.json({ message: bad ? msg : "Internal server error" }, { status: bad ? 400 : 500, headers: NO_STORE });
  }
}
