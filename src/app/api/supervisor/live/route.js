import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { query } from "@/lib/db";
import { LIVE_THRESHOLD_SECONDS } from "@/lib/supervisor";
import { ensureUnfilteredCallLogSchema } from "@/lib/unfilteredContacts";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSupervisor(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    await ensureUnfilteredCallLogSchema();
    const users = await query(
      `SELECT
         u.id, u.username, u.role, u.last_seen_at, u.is_active,
         (
           SELECT MAX(c.called_at)
           FROM calls c
           WHERE c.user_id = u.id
         ) AS last_regular_call_at,
         -- Unfiltered Calls count as calling activity too.
         (SELECT MAX(l.created_at) FROM unfiltered_call_logs l WHERE l.caller_id = u.id) AS last_unfiltered_call_at
       FROM users u
       WHERE u.is_active = 1
         AND u.role IN ('caller','user','agent')
       ORDER BY u.last_seen_at DESC`
    );

    const now = Date.now();
    const result = users.map((row) => {
      const { last_regular_call_at: r, last_unfiltered_call_at: f, ...rest } = row;
      const u = { ...rest, last_call_at: !r ? f || null : !f ? r : (new Date(f) > new Date(r) ? f : r) };
      const lastSeenMs = u.last_seen_at ? new Date(u.last_seen_at).getTime() : 0;
      const lastCallMs = u.last_call_at ? new Date(u.last_call_at).getTime() : 0;
      const secondsSinceSeen = lastSeenMs ? Math.floor((now - lastSeenMs) / 1000) : null;
      const secondsSinceCall = lastCallMs ? Math.floor((now - lastCallMs) / 1000) : null;

      let status = "offline";
      if (secondsSinceSeen !== null && secondsSinceSeen <= LIVE_THRESHOLD_SECONDS) {
        // Treat user as on-call if their last call landed in the last 5 min, else idle
        status = secondsSinceCall !== null && secondsSinceCall <= 300 ? "on_call" : "idle";
        if (secondsSinceCall !== null && secondsSinceCall <= 60) status = "on_call";
      }
      return {
        id: u.id,
        username: u.username,
        role: u.role,
        status,
        seconds_since_seen: secondsSinceSeen,
        seconds_since_call: secondsSinceCall,
        last_seen_at: u.last_seen_at,
        last_call_at: u.last_call_at,
      };
    });

    return Response.json({ users: result });
  } catch (err) {
    console.error("supervisor/live error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
