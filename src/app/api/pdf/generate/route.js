import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { generateCommonPDF } from "@/lib/pdf/generatePdf";

export const dynamic = "force-dynamic";

// Shared endpoint behind the reusable <CommonPDFExportButton>. A page hands over
// EXACTLY the data it is currently displaying (already filtered / already fetched
// through its own access-controlled APIs) and gets back a consistent PDF with the
// global common header. No page-specific PDF route is needed.
//
// Access model: this renders data the caller already legitimately holds on their
// screen — it exposes nothing new, so it can never bypass Page Access (the page's
// own data APIs already enforced it). We still require a valid session so anonymous
// callers can't use it as a rendering service, and we cap the payload so a huge
// body can't exhaust the worker.
const MAX_BODY = 6 * 1024 * 1024; // 6 MB — plenty for large tables + a few images.
const MAX_ROWS = 20000;
const MAX_IMAGES = 12;

function safeFilename(name, fallback) {
  const base = String(name || fallback || "export")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  const clean = base || fallback || "export";
  return clean.toLowerCase().endsWith(".pdf") ? clean : `${clean}.pdf`;
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY) {
      return NextResponse.json({ message: "Export payload too large." }, { status: 413 });
    }
    let payload;
    try {
      payload = JSON.parse(raw || "{}");
    } catch {
      return NextResponse.json({ message: "Invalid JSON." }, { status: 400 });
    }

    // Defensive caps so a malformed/oversized payload can't stall a worker.
    if (payload?.table?.rows && payload.table.rows.length > MAX_ROWS) {
      payload.table.rows = payload.table.rows.slice(0, MAX_ROWS);
      payload.subtitle = `${payload.subtitle ? payload.subtitle + " · " : ""}showing first ${MAX_ROWS} rows`;
    }
    if (Array.isArray(payload?.images) && payload.images.length > MAX_IMAGES) {
      payload.images = payload.images.slice(0, MAX_IMAGES);
    }

    const generatedBy = session.user.username || session.user.name || "";
    const buffer = await generateCommonPDF({ ...payload, generatedBy });
    const filename = safeFilename(payload.filename, "export");

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[pdf/generate] error:", err?.message || err);
    return NextResponse.json({ message: "Failed to generate PDF." }, { status: 500 });
  }
}
