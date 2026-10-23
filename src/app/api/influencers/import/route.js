import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import * as XLSX from "xlsx";
import { authOptions } from "@/lib/auth";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { getPool } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { ensureInfluencerSchema, getInfluencerColumns } from "@/lib/influencerSchema";
import { parseInfluencerSheet, existingInfluencerPhoneKeys } from "@/lib/influencerIO";
import { INFLUENCER_IMPORT_FIELDS } from "@/lib/influencerColumns";
import { validate, coerce, assertJoinedByStorable } from "../route";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;
const LOCK = "aapadmin_influencer_import";

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE }) };
  if (!(await userCanAccessPageKey(session, "influencers"))) return { error: NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE }) };
  await ensureInfluencerSchema();
  return { session };
}

// GET /api/influencers/import?template=1 — sample Excel with the accepted headings.
export async function GET() {
  const { error } = await guard();
  if (error) return error;
  const head = INFLUENCER_IMPORT_FIELDS.map((f) => f.label + (f.required ? " *" : ""));
  const sample = {
    name: "Ramesh Kumar", phone: "9876543210", assembly: "Abhanpur", address: "Ward 4, Abhanpur", age: "45", caste: "",
    current_party: "INC", party_years: "10", political_position: "Sarpanch", org_position: "", associated_since: "2015",
    social_media: "", team_size: "50", social_reach: "", economic_status: "Middle", influencer_rating: "7",
    status: "Pending", join_date: "", cancelled_date: "", cancellation_remark: "", joined_by_phone: "", remark: "",
  };
  const ws = XLSX.utils.aoa_to_sheet([head, INFLUENCER_IMPORT_FIELDS.map((f) => sample[f.key] ?? "")]);
  ws["!cols"] = head.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Influencers");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new NextResponse(new Uint8Array(buf), {
    headers: { ...NO_STORE, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="Influencer_Import_Template.xlsx"' },
  });
}

// POST (multipart "file") — bulk import from CSV / Excel. Every row goes through
// the SAME validate + coerce as the Add Influencer form (required fields, assembly
// → District / Lok Sabha / Zone, Joined By link, status dates). Duplicates by
// normalized phone (in the file or already saved) are skipped, never overwritten.
// One import at a time (named lock) and the duplicate set is read inside the lock,
// so concurrent uploads can't insert the same phone twice.
export async function POST(req) {
  const { session, error } = await guard();
  if (error) return error;
  let conn = null;
  let locked = false;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ message: "No file uploaded" }, { status: 400, headers: NO_STORE });
    if (file.size > MAX_BYTES) return NextResponse.json({ message: "File is too large (max 10 MB)." }, { status: 400, headers: NO_STORE });
    let rows;
    try {
      const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer", cellDates: true });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    } catch {
      return NextResponse.json({ message: "Could not read the file. Use .xlsx, .xls, or .csv." }, { status: 400, headers: NO_STORE });
    }
    if (rows.length < 2) return NextResponse.json({ message: "The sheet has no data rows." }, { status: 400, headers: NO_STORE });
    if (rows.length - 1 > MAX_ROWS) return NextResponse.json({ message: `Too many rows (max ${MAX_ROWS} per file). Split the file and import in parts.` }, { status: 400, headers: NO_STORE });

    const parsed = await parseInfluencerSheet(rows);
    if (parsed.error) return NextResponse.json({ message: parsed.error }, { status: 400, headers: NO_STORE });
    if (!parsed.total) return NextResponse.json({ message: "The sheet has no data rows." }, { status: 400, headers: NO_STORE });
    const { total, dupFile, candidates, rowErrors } = parsed;
    let invalid = parsed.invalid;

    conn = await getPool().getConnection();
    const [[lk]] = await conn.query("SELECT GET_LOCK(?, 60) AS ok", [LOCK]);
    if (Number(lk?.ok) !== 1) return NextResponse.json({ message: "Another influencer import is running. Please try again in a moment." }, { status: 409, headers: NO_STORE });
    locked = true;

    const existing = await existingInfluencerPhoneKeys();
    const cols = await getInfluencerColumns();
    let added = 0, dupExisting = 0;
    for (const c of candidates) {
      if (existing.has(c.key)) {
        dupExisting++;
        rowErrors.push({ row: c.row, name: c.d.name, mobile: c.d.phone, severity: "duplicate", reasons: ["Phone already exists in Influencers — existing record left unchanged"] });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const err = await validate(c.d);
      if (err) {
        invalid++;
        rowErrors.push({ row: c.row, name: c.d.name, mobile: c.d.phone, severity: "error", reasons: [err] });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const record = { ...(await coerce(c.d)), created_by: session.user.id || null };
      assertJoinedByStorable(record, cols);
      const names = Object.keys(record).filter((k) => cols.has(k));
      // eslint-disable-next-line no-await-in-loop
      await conn.query(
        `INSERT INTO influencers (${names.map((n) => `\`${n}\``).join(", ")}) VALUES (${names.map(() => "?").join(",")})`,
        names.map((n) => record[n])
      );
      existing.add(c.key);
      added++;
    }
    const duplicates = dupFile + dupExisting;
    rowErrors.sort((a, b) => a.row - b.row);
    await logAudit(session, {
      action: "influencers.import", entityType: "influencers", entityId: null,
      details: { file: file.name, total, imported: added, duplicates, invalid },
    }).catch(() => {});
    return NextResponse.json({
      total_rows: total, added, duplicates, duplicates_in_file: dupFile, duplicates_existing: dupExisting, invalid,
      row_errors: rowErrors,
    }, { headers: NO_STORE });
  } catch (err) {
    console.error("[influencer] import error:", err?.sqlMessage || err?.message || err);
    return NextResponse.json({ message: `Import failed: ${err?.sqlMessage || err?.message || "server error"}` }, { status: 500, headers: NO_STORE });
  } finally {
    if (conn) {
      if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [LOCK]).catch(() => {});
      conn.release();
    }
  }
}
