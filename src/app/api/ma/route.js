import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isMaEnabled, setMaEnabled, canManageMa } from "@/lib/maAccess";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

// GET: is Amount & Expenses currently shown? (any signed-in user - the UI needs it for the sidebar/Dashboard.)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
  return NextResponse.json({ enabled: await isMaEnabled(), can_manage: canManageMa(session) }, { headers: NO_STORE });
}

// PUT { enabled }: Show/Hide. Super Admin only, enforced here. Only the flag changes - no financial record is touched.
export async function PUT(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
  if (!canManageMa(session)) return NextResponse.json({ message: "Only the Admin can change this setting." }, { status: 403, headers: NO_STORE });
  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") return NextResponse.json({ message: "enabled must be true or false." }, { status: 400, headers: NO_STORE });
  const before = await isMaEnabled();
  await setMaEnabled(body.enabled);
  logAudit(session, { action: "ma.toggle", entityType: "setting", entityId: "ma_enabled", details: { from: before, to: body.enabled } }).catch(() => {});
  return NextResponse.json({ enabled: await isMaEnabled(), can_manage: true }, { headers: NO_STORE });
}
