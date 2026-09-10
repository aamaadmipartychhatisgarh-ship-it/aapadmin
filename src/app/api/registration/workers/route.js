import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRegistrationAccess, NO_STORE, parseRegFilters } from "@/lib/registrationGuard";
import { newLinkToken, workerCodeFor, normalizeMobile } from "@/lib/registrationSchema";
import { phoneKey, last10Sql } from "@/lib/phone";
import { getWorkerRanking, countWorkers } from "@/lib/registrationStats";

// A worker link is an OTP-gated login (the karyakarta signs in with THIS mobile
// to use their link), so it MUST carry a usable number — a link created without
// one can never satisfy the gate and returns 403 forever. Prefer the strict
// Indian-mobile normaliser, but fall back to the last-10-digit key so a valid
// number in an unusual format is never silently dropped to NULL (the same
// matching rule the OTP gate itself uses).
function linkMobile(v) {
  const n = normalizeMobile(v);
  if (n) return n;
  const k = phoneKey(v);
  return k && k.length === 10 ? k : null;
}

// The worker roster + their unique links. GET returns the same shape as the
// worker ranking (rank, voters added, workers added, total) so the "Workers &
// Links" table and the "Worker-wise Performance" report are one query, never two
// disagreeing ones.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(req) {
  try {
    const { error } = await requireRegistrationAccess();
    if (error) return error;
    const { searchParams } = new URL(req.url);
    const f = parseRegFilters(searchParams);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "25", 10) || 25));
    const [workers, total] = await Promise.all([
      getWorkerRanking({ ...f, limit: pageSize, offset: (page - 1) * pageSize }),
      countWorkers(f),
    ]);
    return NextResponse.json(
      { workers, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) },
      { headers: NO_STORE }
    );
  } catch (e) {
    console.error("[registration] workers GET error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// POST → create one worker, or many at once from pasted lines.
// Bulk format, one worker per line: Name, Mobile, Ward, Area/Booth (comma or tab
// separated; only the name is required). Each worker gets their own token, so a
// paste of 200 names produces 200 distinct links in one action.
export async function POST(req) {
  try {
    const { session, error } = await requireRegistrationAccess();
    if (error) return error;
    const d = await req.json().catch(() => null);
    if (!d || typeof d !== "object") return NextResponse.json({ message: "Invalid request." }, { status: 400, headers: NO_STORE });

    const campaignId = /^\d+$/.test(String(d.campaign_id || "")) ? Number(d.campaign_id) : null;
    if (!campaignId) return NextResponse.json({ message: "Select an election drive first." }, { status: 400, headers: NO_STORE });
    const [campaign] = await query(`SELECT id FROM reg_campaigns WHERE id = ?`, [campaignId]);
    if (!campaign) return NextResponse.json({ message: "That election drive no longer exists." }, { status: 404, headers: NO_STORE });

    // Normalize both shapes (single worker / pasted block) into one list.
    let entries = [];
    if (typeof d.bulk === "string" && d.bulk.trim()) {
      entries = d.bulk.split(/\r?\n/).map((line) => {
        const parts = line.split(/\t|,/).map((s) => s.trim());
        return { name: parts[0], mobile: parts[1], ward_number: parts[2], area_booth: parts[3] };
      });
    } else {
      entries = [{ name: d.name, mobile: d.mobile, ward_number: d.ward_number, area_booth: d.area_booth }];
    }
    entries = entries.filter((e) => String(e.name || "").trim());
    if (!entries.length) return NextResponse.json({ message: "Enter at least one worker name." }, { status: 400, headers: NO_STORE });
    if (entries.length > 500) return NextResponse.json({ message: "Add at most 500 workers at a time." }, { status: 400, headers: NO_STORE });

    const clip = (v, n) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
    const created = [];
    const skipped = [];
    for (const e of entries) {
      const name = String(e.name).trim().slice(0, 160);
      const mobile = linkMobile(e.mobile);
      // Every worker link needs a valid mobile — without one the OTP gate can
      // never be passed, so skip (and report) rather than mint a dead link.
      if (!mobile) { skipped.push({ name, mobile: String(e.mobile || "").trim() || null, reason: "needs a valid 10-digit mobile number" }); continue; }
      // One link per mobile number within a drive — re-pasting the same list must
      // not silently mint a second link and split a worker's credit in two.
      // Match on the last 10 digits so an older-format stored number still dedups.
      const [dupe] = await query(`SELECT id FROM reg_workers WHERE campaign_id = ? AND ${last10Sql("mobile")} = ? LIMIT 1`, [campaignId, mobile]);
      if (dupe) { skipped.push({ name, mobile, reason: "already has a link" }); continue; }
      const res = await query(
        `INSERT INTO reg_workers (campaign_id, name, mobile, token, ward_number, area_booth, created_by)
         VALUES (?,?,?,?,?,?,?)`,
        [campaignId, name, mobile, newLinkToken(), clip(e.ward_number, 60), clip(e.area_booth, 160), session?.user?.id || null]
      );
      // The User ID is derived from the immutable row id, so it is assigned once
      // here and never regenerated for that worker.
      await query(`UPDATE reg_workers SET worker_code = ? WHERE id = ?`, [workerCodeFor(name, res.insertId), res.insertId]);
      const [row] = await query(`SELECT * FROM reg_workers WHERE id = ?`, [res.insertId]);
      created.push(row);
    }

    return NextResponse.json({ created, skipped, count: created.length }, { status: 201, headers: NO_STORE });
  } catch (e) {
    console.error("[registration] workers POST error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
