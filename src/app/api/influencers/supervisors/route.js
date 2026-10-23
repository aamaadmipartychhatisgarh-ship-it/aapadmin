import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET /api/influencers/supervisors → active supervisor users, for the Influencer
// form's "Assigned Supervisor-2" dropdown. Same gate as the Influencer module.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
  if (!(await userCanAccessPageKey(session, "influencers"))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
  const rows = await query("SELECT id, username FROM users WHERE role = 'supervisor' AND is_active = 1 ORDER BY username ASC");
  return NextResponse.json({ supervisors: rows }, { headers: NO_STORE });
}
