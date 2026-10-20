import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isCaller } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { loadComplaintRows } from "@/lib/complaintsList";
import { generateCommonPDF } from "@/lib/pdf/generatePdf";
import { ensureComplaintColumns } from "../route";

export const dynamic = "force-dynamic";

const dt = (v) => (v ? new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "");
const cap = (v) => (v ? String(v).replace(/_/g, " ").replace(/^./, (m) => m.toUpperCase()) : "");

// GET /api/complaints/export?status=&type=&district_id=&search= → a PDF of the
// complaints the viewer is allowed to see under those filters. The data is read HERE,
// through the same loader (same filters + geographic scope + Assembly rule) as the
// on-screen list, instead of trusting rows posted from the browser — so the file
// can't contain anything the viewer couldn't open, and each description is read from
// its own complaint row. Every complaint appears once (de-duplicated by id).
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "complaints", session && (isOversight(session) || isCaller(session))))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureComplaintColumns();
    const sp = new URL(req.url).searchParams;
    const { rows } = await loadComplaintRows(session, sp);

    const seen = new Set();
    const complaints = rows.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));

    const records = complaints.map((c) => {
      const age = Number(c.age_hours) || 0;
      const overdue = (c.status === "open" || c.status === "in_progress") && age >= 72;
      return {
        heading: `#${c.id}  ·  ${c.citizen_name || "—"}`,
        badge: `${String(c.status || "").replace(/_/g, " ").toUpperCase()}${overdue ? "  ·  OVERDUE" : ""}`,
        fields: [
          ["Phone", c.citizen_phone],
          ["Designation", c.designation_name],
          ["Category / Type", cap(c.type)],
          ["District", c.district_name],
          ["Assembly", c.assembly_name],
          ["Department / Assigned team", c.team_name],
          ["Logged on", dt(c.created_at)],
          ["Resolved on", dt(c.resolved_at)],
        ],
        blocks: [
          { label: "Description", text: c.description },
          ...(c.resolution_notes ? [{ label: "Resolution notes / Remarks", text: c.resolution_notes }] : []),
        ],
      };
    });

    // Human-readable filter summary for the PDF subtitle.
    const parts = [`${records.length} complaint${records.length === 1 ? "" : "s"}`];
    if (sp.get("status")) parts.push(`status: ${String(sp.get("status")).replace(/_/g, " ")}`);
    if (sp.get("type")) parts.push(`type: ${sp.get("type")}`);
    if (sp.get("district_id")) {
      const [d] = await query("SELECT name FROM locations WHERE id = ?", [sp.get("district_id")]).catch(() => []);
      if (d?.name) parts.push(`district: ${d.name}`);
    }
    if (sp.get("search")) parts.push(`search: "${sp.get("search")}"`);

    const buffer = await generateCommonPDF({
      title: "Complaints",
      subtitle: parts.join("  ·  "),
      orientation: "portrait",
      generatedBy: session.user.username || session.user.name || "",
      records,
    });
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="complaints.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[complaints] export error:", err?.message || err);
    return NextResponse.json({ message: "Failed to generate PDF." }, { status: 500 });
  }
}
