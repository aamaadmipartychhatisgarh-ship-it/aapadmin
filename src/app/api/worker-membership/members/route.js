import { NextResponse } from "next/server";
import { requireSuperAdmin, NO_STORE, parseCommonFilters } from "@/lib/superAdminGuard";
import { getMembersPage } from "@/lib/membershipStats";

// Paginated member list, joined to the worker who added each member. Server-side
// search / filters / pagination. Super-Admin only.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(req) {
  try {
    const { error } = await requireSuperAdmin();
    if (error) return error;
    const { searchParams } = new URL(req.url);
    const f = parseCommonFilters(searchParams);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10) || 20));
    const data = await getMembersPage({
      ...f,
      certificate: searchParams.get("certificate") || null,
      whatsapp: searchParams.get("whatsapp") || null,
      sms: searchParams.get("sms") || null,
      page, pageSize,
    });
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (err) {
    console.error("[membership] members error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
