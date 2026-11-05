import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canAccessSocial } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { followersGrowth, PLATFORM_LABEL } from "@/lib/socialFollowers";
import { todayIST, isIsoDate, fmtDMY } from "@/lib/socialDates";
import { generateCommonPDF } from "@/lib/pdf/generatePdf";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const signed = (n) => (n > 0 ? `+${n.toLocaleString("en-IN")} (Increase)` : n < 0 ? `-${Math.abs(n).toLocaleString("en-IN")} (Decrease)` : "0 (No change)");

// GET /api/social-management/followers-growth?start=YYYY-MM-DD&end=YYYY-MM-DD[&platform=facebook|instagram|twitter][&format=pdf]
// Followers Growth / Margin per page = ending followers - starting followers, each the recorded count on or before that date.
// The PDF is built from exactly the same figures, for exactly the requested range and platform filter.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: "Not signed in." }, { status: 401, headers: NO_STORE });
    if (!(await pageAllowed(session, "social_management", canAccessSocial(session)))) return NextResponse.json({ message: "You don't have access to Social Command." }, { status: 403, headers: NO_STORE });
    const sp = new URL(req.url).searchParams;
    const today = todayIST();
    const end = sp.get("end") || today, start = sp.get("start");
    if (!isIsoDate(start) || !isIsoDate(end)) return NextResponse.json({ message: "Choose a valid Start Date and End Date." }, { status: 400, headers: NO_STORE });
    if (start > end) return NextResponse.json({ message: "Start Date cannot be later than End Date." }, { status: 400, headers: NO_STORE });
    if (end > today) return NextResponse.json({ message: "End Date cannot be in the future." }, { status: 400, headers: NO_STORE });
    const platform = Object.keys(PLATFORM_LABEL).includes(sp.get("platform")) ? sp.get("platform") : null;
    const data = await followersGrowth(session, { start, end, platform, userId: session.user.id });

    if (sp.get("format") === "pdf") {
      const t = data.totals;
      const buf = await generateCommonPDF({
        title: "Followers Growth & Comparison",
        subtitle: `${fmtDMY(start)} to ${fmtDMY(end)}${platform ? ` · ${PLATFORM_LABEL[platform]}` : " · All platforms"} · ${t.compared} of ${t.pages} page${t.pages === 1 ? "" : "s"} compared`,
        orientation: "landscape",
        generatedBy: session.user.username || "",
        sections: [
          {
            title: "Period",
            columns: [{ header: "Start Date", flex: 1 }, { header: "End Date", flex: 1 }, { header: "Starting Followers", flex: 1, align: "right" }, { header: "Current Followers", flex: 1, align: "right" }, { header: "Total Followers Growth / Margin", flex: 1.6, align: "right" }],
            rows: [[fmtDMY(start), fmtDMY(end), t.compared ? t.start_followers.toLocaleString("en-IN") : "—", t.compared ? t.end_followers.toLocaleString("en-IN") : "—", t.compared ? signed(t.growth) : "Unavailable"]],
          },
          {
            title: "Pages",
            columns: [{ header: "Page / Account", flex: 2.2 }, { header: "Platform", flex: 1 }, { header: "Start Date", flex: 1 }, { header: "End Date", flex: 1 }, { header: "Starting Followers", flex: 1, align: "right" }, { header: "Current Followers", flex: 1, align: "right" }, { header: "Growth / Margin", flex: 1.5, align: "right" }],
            rows: data.rows.map((r) => [
              r.handle || "—", r.platform_label, fmtDMY(start), fmtDMY(end),
              r.status === "ok" ? r.start_followers.toLocaleString("en-IN") : "—", r.status === "ok" ? r.end_followers.toLocaleString("en-IN") : "—",
              r.status === "ok" ? signed(r.growth) : "Data unavailable",
            ]),
          },
          ...(t.unavailable ? [{ title: "Not compared", text: data.rows.filter((r) => r.status !== "ok").map((r) => `${r.handle} (${r.platform_label}): ${r.note}`).join("\n") + "\nThese pages are left out of the totals above; a missing record is never counted as zero." }] : []),
          { text: "Starting and Current Followers are the recorded follower count on or before the Start Date and End Date respectively (the nearest dated snapshot on or before that day)." },
        ],
      });
      return new NextResponse(new Uint8Array(buf), { status: 200, headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="AAP_Followers_Growth_${start}_to_${end}.pdf"` } });
    }
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (e) {
    console.error("followers-growth error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
