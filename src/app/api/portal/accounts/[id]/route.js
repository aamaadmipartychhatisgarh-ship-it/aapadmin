import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isTopAdmin } from "@/lib/permissions";
import { updateWorkerAccount, PortalAccountError } from "@/lib/portalAccounts";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// PUT — edit one Worker account in place (name, phone, status, territory).
// Admin only; refuses any user whose role is not 'worker'.
export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isTopAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await updateWorkerAccount(id, body, session), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof PortalAccountError) {
      return NextResponse.json({ message: err.message }, { status: err.status, headers: NO_STORE });
    }
    console.error("[portal] accounts PUT:", err?.message || err);
    return NextResponse.json({ message: "Internal server error", detail: err?.sqlMessage || err?.message || null }, { status: 500, headers: NO_STORE });
  }
}
