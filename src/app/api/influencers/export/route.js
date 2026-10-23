import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import * as XLSX from "xlsx";
import { authOptions } from "@/lib/auth";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { ensureInfluencerSchema } from "@/lib/influencerSchema";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";
import { influencerListWhere, enrichJoinedBy, INFLUENCER_SORTS, createdBySelect, INFLUENCER_EXPORT_COLUMNS } from "@/lib/influencerIO";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
const MAX_ROWS = 50000;

// Excel opens a CSV cell starting with = + - @ as a formula; a leading quote
// neutralises that without changing the visible value.
function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/influencers/export?format=csv|xlsx&search=&status=&assembly_id=&potential_rating=&sort=
// Exactly the records the Influencer list shows for the same search / filters
// (all of them when none are set), in the list's order, with Joined By resolved
// the same way the list resolves it.
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (!(await userCanAccessPageKey(session, "influencers"))) return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE });
    await ensureInfluencerSchema();
    await ensureContactDesignationsSchema().catch(() => {});
    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
    const { whereSql, params } = influencerListWhere(searchParams);
    const orderBy = INFLUENCER_SORTS[searchParams.get("sort")] || INFLUENCER_SORTS.newest;
    const rows = await query(
      `SELECT influencers.*, ${await createdBySelect()} FROM influencers ${whereSql} ORDER BY ${orderBy}, id DESC LIMIT ${MAX_ROWS}`,
      params
    );
    await enrichJoinedBy(rows);
    const head = INFLUENCER_EXPORT_COLUMNS.map(([h]) => h);
    const body = rows.map((r) => INFLUENCER_EXPORT_COLUMNS.map(([, get]) => { const v = get(r); return v === null || v === undefined ? "" : v; }));
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "xlsx") {
      const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
      ws["!cols"] = head.map((h) => ({ wch: Math.max(12, h.length + 2) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Influencers");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      return new NextResponse(new Uint8Array(buf), {
        headers: { ...NO_STORE, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="AAP_Influencers_${stamp}.xlsx"` },
      });
    }
    // UTF-8 BOM so Excel shows Hindi text correctly.
    const csv = "﻿" + [head, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n");
    return new NextResponse(csv, {
      headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="AAP_Influencers_${stamp}.csv"` },
    });
  } catch (err) {
    console.error("[influencer] export error:", err?.sqlMessage || err?.message || err);
    return NextResponse.json({ message: "Could not generate the export." }, { status: 500, headers: NO_STORE });
  }
}
