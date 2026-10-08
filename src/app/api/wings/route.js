import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ensureWingSchema, listWings } from "@/lib/wingDesignations";

// GET /api/wings — the live list of Wings configured in Master Data → Designation,
// the SINGLE source of truth for the Wings dropdown across the app (Contacts, Add
// Contact, Designation Vacancy, Incomplete Designation, My Workspace). Any
// signed-in user may read it (it is just the option list, not master-data
// management), so these non-admin pages can populate the dropdown without the
// admin-only designation-master endpoint. Add/edit/remove a Wing in the master and
// every consumer updates automatically — nothing here is hard-coded.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    await ensureWingSchema();
    const all = await listWings();
    // Only enabled wings are offered as options; names/spelling come straight from
    // the master so they match everywhere.
    const wings = all.filter((w) => w.enabled == null || Number(w.enabled) === 1)
      .map((w) => ({ id: w.id, name: w.name, is_main: Number(w.is_main) === 1 }));
    return NextResponse.json({ wings }, { headers: NO_STORE });
  } catch (e) {
    console.error("[wings] GET error:", e?.sqlMessage || e?.message || e);
    return NextResponse.json({ wings: [] }, { headers: NO_STORE });
  }
}
