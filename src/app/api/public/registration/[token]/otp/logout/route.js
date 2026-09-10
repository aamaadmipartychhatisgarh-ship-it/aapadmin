import { NextResponse } from "next/server";
import { regSessionCookie } from "@/lib/regLinkAuth";

// POST /api/public/registration/<token>/otp/logout → clears the handler session.
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(regSessionCookie("", { clear: true }));
  return res;
}
