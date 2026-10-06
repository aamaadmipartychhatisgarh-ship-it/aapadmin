import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isTopAdmin } from "@/lib/permissions";
import { createPortalAccount, listEligibleDesignations, portalUserId, PortalAccountError, PORTAL_PAGES } from "@/lib/portalAccounts";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// Member account creation form (one person at a time). Same admin gate as the
// bulk provisioning console; same account rules (see lib/portalAccounts.js).

// GET — the designations an admin may choose from (eligible levels only) plus
// the pages every created account receives. Optional ?name=&phone= returns the
// User ID the form would generate, so the admin can preview it before saving.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isTopAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const { searchParams } = new URL(req.url);
    const designations = await listEligibleDesignations();
    const name = searchParams.get("name");
    const phone = searchParams.get("phone");
    return NextResponse.json({
      designations: designations.map((d) => ({ id: d.id, name: d.name, level: d.level, wing: d.wing || null })),
      pages: PORTAL_PAGES,
      preview_user_id: name != null || phone != null ? portalUserId(name, phone) : undefined,
    }, { headers: NO_STORE });
  } catch (err) {
    console.error("[portal] accounts GET:", err?.message || err);
    return NextResponse.json({ message: "Internal server error", detail: err?.sqlMessage || err?.message || null }, { status: 500, headers: NO_STORE });
  }
}

// POST — create one account. Body: { name, phone, designation_ids | designation_id,
// zone_id?, lok_sabha_id?, district_id?, assembly_id? }. Returns the generated
// User ID; the password is the fixed '#' and is never returned.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isTopAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const body = await req.json().catch(() => ({}));
    const result = await createPortalAccount(body, session);
    return NextResponse.json({ ok: true, ...result, pages: PORTAL_PAGES }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof PortalAccountError) {
      return NextResponse.json({ message: err.message, username: err.username, contact_id: err.contact_id }, { status: err.status, headers: NO_STORE });
    }
    console.error("[portal] accounts POST:", err?.message || err);
    return NextResponse.json({ message: "Internal server error", detail: err?.sqlMessage || err?.message || null }, { status: 500, headers: NO_STORE });
  }
}
