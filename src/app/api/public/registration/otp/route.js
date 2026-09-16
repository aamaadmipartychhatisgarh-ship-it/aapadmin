import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { normalizeMobile } from "@/lib/registrationSchema";
import { resolveLink, NO_STORE } from "@/lib/publicRegistration";
import { requestOtp, checkOtp, otpConfigured } from "@/lib/registrationOtp";

// Mobile verification for the public form: POST { action: "send" | "verify" }.
//
// Unauthenticated by necessity — the person proving their number has no account.
// That makes it the most abusable endpoint in the product, since every "send"
// spends real prepaid credit, so the limits in lib/registrationOtp.js are the
// load-bearing part and they are enforced in the database, not here.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

function clientIp(req) {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim().slice(0, 64);
}

export async function POST(req) {
  try {
    const d = await req.json().catch(() => null);
    if (!d || typeof d !== "object") {
      return NextResponse.json({ message: "Invalid request." }, { status: 400, headers: NO_STORE });
    }
    if (!otpConfigured()) {
      return NextResponse.json(
        { message: "Mobile verification is not configured. Please contact your in-charge." },
        { status: 503, headers: NO_STORE }
      );
    }

    const mobile = normalizeMobile(d.mobile);
    if (!mobile) {
      return NextResponse.json({ message: "Please enter a valid 10-digit mobile number." }, { status: 400, headers: NO_STORE });
    }

    // The link still has to be open — otherwise a closed drive would keep
    // spending SMS credit for registrations it will refuse anyway.
    const link = await resolveLink(d.token || null);
    if (!link) {
      return NextResponse.json({ message: "Registration is not open right now." }, { status: 404, headers: NO_STORE });
    }

    const ip = clientIp(req);

    if (d.action === "verify") {
      const res = await checkOtp({ mobile, code: d.code, ip });
      if (!res.ok) return NextResponse.json({ message: res.message }, { status: res.status, headers: NO_STORE });
      return NextResponse.json({ ok: true, verified: true }, { headers: NO_STORE });
    }

    // Refuse to spend an SMS on a number that cannot be registered anyway. This
    // check has to happen BEFORE the send, not at submit: otherwise every
    // already-registered person costs a credit and still hits a dead end.
    const [dupe] = await query(
      `SELECT id FROM reg_people WHERE campaign_id = ? AND mobile = ? AND status = 'active' LIMIT 1`,
      [link.campaign_id, mobile]
    );
    if (dupe) {
      return NextResponse.json(
        { message: "This mobile number is already registered.", duplicate: true },
        { status: 409, headers: NO_STORE }
      );
    }

    const res = await requestOtp({ mobile, campaignId: link.campaign_id, ip });
    if (!res.ok) return NextResponse.json({ message: res.message }, { status: res.status, headers: NO_STORE });
    return NextResponse.json({ ok: true, sent: true, reused: !!res.reused, ttlMinutes: res.ttlMinutes }, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] OTP endpoint error:", e);
    return NextResponse.json({ message: "Something went wrong. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
