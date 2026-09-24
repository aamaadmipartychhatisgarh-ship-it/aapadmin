import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { photoDataPage, photoSummary, recoverAndVerify } from "@/lib/contactPhotoRecovery";

// Photo Data (Admin) — the audited contact-photo view.
//   GET ?summary=1        → live counts (with-reference / available / unavailable / unverified)
//   GET (list params)     → paginated: Contact, Name, Mobile, Photo, Photo Status
//   POST { offset?, limit? } → run recovery + verification: reconnect photos whose
//                             files still exist (incl. registration photos) and mark
//                             each contact's real photo availability. Never deletes.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

async function guard() {
  const session = await getServerSession(authOptions);
  if (!(await pageAllowed(session, "contacts", session && isAdmin(session)))) {
    return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE }) };
  }
  return { session };
}

export async function GET(req) {
  try {
    const { error } = await guard();
    if (error) return error;
    const sp = new URL(req.url).searchParams;
    if (sp.get("summary") === "1") {
      return NextResponse.json({ summary: await photoSummary() }, { headers: NO_STORE });
    }
    const data = await photoDataPage({
      page: parseInt(sp.get("page"), 10) || 1,
      pageSize: parseInt(sp.get("page_size"), 10) || 30,
      search: sp.get("search") || "",
      status: sp.get("status") || "",
    });
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (err) {
    console.error("[photo-data] GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req) {
  try {
    const { error } = await guard();
    if (error) return error;
    const d = await req.json().catch(() => ({}));
    const result = await recoverAndVerify({
      apply: true,
      limit: parseInt(d?.limit, 10) || 3000,
      offset: parseInt(d?.offset, 10) || 0,
    });
    const summary = await photoSummary();
    return NextResponse.json({ ...result, summary }, { headers: NO_STORE });
  } catch (err) {
    console.error("[photo-data] POST error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
