import { NextResponse } from "next/server";
import { requireSuperAdmin, NO_STORE, parseCommonFilters } from "@/lib/superAdminGuard";
import { getWorkersPage } from "@/lib/membershipStats";

// Paginated worker table with per-worker member counts + global rank. Server-side
// search / filters / sort / pagination. Super-Admin only.
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
    const data = await getWorkersPage({
      ...f,
      workerStatus: searchParams.get("worker_status") || null,
      membership: searchParams.get("membership") || null, // 'with' | 'zero'
      sort: searchParams.get("sort") || "members",
      dir: searchParams.get("dir") || "desc",
      page, pageSize,
    });
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (err) {
    console.error("[membership] workers error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
