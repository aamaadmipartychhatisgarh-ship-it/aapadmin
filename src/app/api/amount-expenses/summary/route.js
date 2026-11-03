import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { maGate, maSummary } from "@/lib/maAccess";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const denied = await maGate(session);
    if (denied) return denied;
    return NextResponse.json(await maSummary(), { headers: NO_STORE });
  } catch (e) {
    console.error("amount-expenses summary error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
