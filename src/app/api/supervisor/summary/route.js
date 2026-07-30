import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { buildOverviewSummary } from "@/lib/overviewSummary";

// Supervisor overview — live KPIs/charts for the selected date range (state-wide,
// no scope). The State Overview reuses the same builder with an admin's territory
// scope, so both dashboards render from identical data.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const summary = await buildOverviewSummary({
      date_from: searchParams.get("date_from"),
      date_to: searchParams.get("date_to"),
    });
    return Response.json(summary);
  } catch (err) {
    console.error("supervisor/summary error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
