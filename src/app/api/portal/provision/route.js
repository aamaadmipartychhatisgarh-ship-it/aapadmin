import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isTopAdmin } from "@/lib/permissions";
import { listEligiblePeople, provisionPortalAccounts, portalUserId } from "@/lib/portalAccounts";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

// GET — the eligible designation-holders (up to Vidhansabha) and whether each one
// already has a portal login account. Admin only.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isTopAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const people = await listEligiblePeople();
    const rows = people.map((p) => ({
      contact_id: p.contact_id,
      name: p.person_name,
      phone: p.phone_number,
      designations: p.designations,
      username: p.existing_username || null,
      would_be_user_id: p.existing_username ? null : portalUserId(p.person_name, p.phone_number),
    }));
    return NextResponse.json({
      eligible: rows.length,
      with_account: rows.filter((r) => r.username).length,
      people: rows,
    }, { headers: NO_STORE });
  } catch (err) {
    console.error("[portal] eligible GET:", err?.message || err);
    return NextResponse.json({ message: "Internal server error", detail: err?.sqlMessage || err?.message || null }, { status: 500, headers: NO_STORE });
  }
}

// POST — create login accounts for every eligible person who doesn't have one yet.
// Admin only. Returns the generated User IDs (passwords are never returned).
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isTopAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const result = await provisionPortalAccounts(session);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error("[portal] provision POST:", err?.message || err);
    return NextResponse.json({ message: "Internal server error", detail: err?.sqlMessage || err?.message || null }, { status: 500, headers: NO_STORE });
  }
}
