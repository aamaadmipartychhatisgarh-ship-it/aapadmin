import { NextResponse as Response } from "next/server";
import { reportsGuard as guard } from "@/lib/reports/guard";
import { getReportShare } from "@/lib/reportShares";

export const dynamic = "force-dynamic";

// GET /api/reports/share/[token]
// Resolves a share token to its stored { module, config }. Access is gated by
// the SAME reportsGuard as the rest of Reports Center, so an unauthenticated or
// unauthorized user can never read a shared report's configuration (and the data
// itself is re-run live under their own permissions/scope by the reports engine).
// Returns 404 for an unknown token and 410 for an expired one — distinct so the
// client can show a clear message.
export async function GET(req, { params }) {
  const { error } = await guard();
  if (error) return error;

  const { token } = await params;
  try {
    const share = await getReportShare(token);
    if (share?.notFound) return Response.json({ message: "This shared report link is invalid or no longer exists." }, { status: 404 });
    if (share?.expired) return Response.json({ message: "This shared report link has expired." }, { status: 410 });
    return Response.json({ module: share.module, config: share.config });
  } catch (e) {
    console.error("[reports] resolve share failed:", e);
    return Response.json({ message: "Could not open the shared report. Please try again." }, { status: 500 });
  }
}
