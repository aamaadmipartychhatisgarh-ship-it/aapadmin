import { NextResponse } from "next/server";
import { sessionCookie } from "@/lib/workerFormAuth";

// POST /api/worker-form/logout → clears the OTP session cookie, so the form locks
// again and the user must re-verify (§21).
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST() {
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(sessionCookie("", { clear: true }));
  return res;
}
