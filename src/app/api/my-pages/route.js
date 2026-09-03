import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getEffectivePageKeys, isPageRestricted } from "@/lib/pageAccess";

// BUG 14 — the caller's OWN effective page access (baseline role pages ∪ any
// explicit grants), computed server-side from the DB. This is the single
// source the dynamic sidebar and the client page-guard both read, so what a
// user can SEE always matches what the backend will ALLOW. No-store so a grant
// or revoke applies on the very next load (§13) without a re-login.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ pages: [] }, { status: 401 });
    const keys = await getEffectivePageKeys(session.user.id, session.user.role);
    const restricted = await isPageRestricted(session);
    // Permission-trace log (per ticket): the EXACT page set this API returns for
    // this user. If the sidebar/route shows more than this, the divergence is on
    // the client; if this shows more than the admin assigned, it is server-side.
    console.log(`[my-pages] user=${session.user.id} role=${session.user.role} restricted=${restricted} pages=${JSON.stringify([...keys])}`);
    return NextResponse.json(
      { pages: [...keys], restricted },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    console.error("my-pages GET error:", err);
    return NextResponse.json({ pages: [] }, { status: 500 });
  }
}
