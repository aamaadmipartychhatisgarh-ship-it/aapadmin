import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const rows = await query(
      `SELECT sentiment, COUNT(*) AS count
         FROM calls
        WHERE sentiment IS NOT NULL
        GROUP BY sentiment`
    );

    const data = {
      positive: 0, negative: 0, neutral: 0, supporter: 0, opponent: 0,
    };
    rows.forEach((r) => { data[r.sentiment] = Number(r.count) || 0; });

    return Response.json({ sentiment: data });
  } catch (err) {
    console.error("supervisor/sentiment error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
