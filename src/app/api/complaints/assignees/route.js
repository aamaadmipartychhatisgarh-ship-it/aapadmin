import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { assignableComplaintUsers } from "@/lib/complaintAccess";

export const dynamic = "force-dynamic";

// GET /api/complaints/assignees — the active Callers a complaint can be assigned to (Admin / Supervisor only).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const users = await assignableComplaintUsers();
  return NextResponse.json({ users: users.map((u) => ({ id: u.id, username: u.username })) }, { headers: { "Cache-Control": "no-store" } });
}
