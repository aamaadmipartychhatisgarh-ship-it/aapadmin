import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { resolveContactByPhone, compactContactCard } from "@/lib/contactCard";

// GET /api/influencers/contact-lookup?phone=XXXXXXXXXX
// The Influencer form's "Joined By" lookup: given a phone number, find the EXISTING
// Contacts record and return its live details (name, photo, mobile, assembly,
// district, lok sabha, zone). It NEVER creates a contact — a miss returns
// { found: false } so the form can show "Contact Not Found". Gated by the same
// "influencers" page key as the form.
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!(await userCanAccessPageKey(session, "influencers"))) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    }
    const phone = new URL(req.url).searchParams.get("phone") || "";
    const digits = phone.replace(/\D/g, "");
    // Validate before the lookup — a 10-digit Indian mobile (optionally 91-prefixed).
    if (digits.length < 10 || digits.length > 12) {
      return NextResponse.json({ found: false, invalid: true, message: "Enter a valid 10-digit phone number." }, { headers: NO_STORE });
    }
    const card = await resolveContactByPhone(digits);
    if (!card) return NextResponse.json({ found: false }, { headers: NO_STORE });
    return NextResponse.json({ found: true, contact: compactContactCard(card) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[influencer] contact-lookup error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
