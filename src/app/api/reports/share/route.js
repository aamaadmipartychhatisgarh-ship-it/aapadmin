import { NextResponse as Response } from "next/server";
import { reportsGuard as guard } from "@/lib/reports/guard";
import { createReportShare } from "@/lib/reportShares";

export const dynamic = "force-dynamic";

// POST /api/reports/share  { module, config }
// Creates a secure, expiring share token for the CURRENT report state and
// returns its token. Only a user who may use Reports (oversight or granted the
// "reports" page — enforced by reportsGuard) can create a share. The token
// stores config only; the shared report is re-run live for whoever opens it, so
// no report data is placed in the token or the URL.
export async function POST(req) {
  const { session, error } = await guard();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const moduleKey = String(body.module || "").trim();
  if (!moduleKey) return Response.json({ message: "module is required" }, { status: 400 });
  const config = body.config && typeof body.config === "object" ? body.config : {};

  // Guard against an oversized config (defensive — a normal report config is tiny).
  if (JSON.stringify(config).length > 200000) {
    return Response.json({ message: "Report configuration is too large to share." }, { status: 400 });
  }

  try {
    const { token, expires_at } = await createReportShare({
      moduleKey, config, createdBy: session.user.id,
    });
    return Response.json({ token, expires_at }, { status: 201 });
  } catch (e) {
    console.error("[reports] create share failed:", e);
    return Response.json({ message: "Could not create the share link. Please try again." }, { status: 500 });
  }
}
