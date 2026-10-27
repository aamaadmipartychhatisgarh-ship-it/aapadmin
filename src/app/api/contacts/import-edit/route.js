import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, isSupervisorRole, scopeFilterSync, normalizeRole, ROLES } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { supervisorScopeFilter } from "@/lib/supervisorScope";
import { logAudit } from "@/lib/audit";
import * as XLSX from "xlsx";
import { parseImportEdit, applyImportEdit } from "@/lib/contactImportEdit";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
const MAX_BYTES = 8 * 1024 * 1024;
const PREVIEW_ROWS = 1000; // rows returned in detail (counts always cover every row)

// POST /api/contacts/import-edit[?dry_run=1] — bulk UPDATE of EXISTING contacts from
// an uploaded .xlsx/.xls/.csv. Separate from the normal Import (which only adds new
// contacts). dry_run=1 validates and returns the preview without writing; without it
// the same validation runs again and the valid rows are applied. Never inserts a
// contact. Same access as the normal Import (oversight / contacts page access) and
// limited to the contacts inside the user's own area.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "contacts", session && isOversight(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ message: "No file uploaded." }, { status: 400, headers: NO_STORE });
    if (file.size > MAX_BYTES) return NextResponse.json({ message: "The file is too large (max 8 MB)." }, { status: 413, headers: NO_STORE });
    if (!/\.(xlsx|xls|csv)$/i.test(file.name || "")) {
      return NextResponse.json({ message: "Unsupported file type. Use .xlsx, .xls or .csv." }, { status: 400, headers: NO_STORE });
    }

    let rows;
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      // CSV is read as UTF-8 text: handed to SheetJS as a raw buffer it is decoded as a legacy
      // single-byte codepage, which garbles Hindi / accented values (and a BOM breaks the
      // first heading). Excel files are read as binary as before.
      const wb = /\.csv$/i.test(file.name || "")
        ? XLSX.read(buf.toString("utf8").replace(/^\uFEFF/, ""), { type: "string" })
        : XLSX.read(buf, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("empty");
      rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    } catch {
      return NextResponse.json({ message: "Could not read the file. It is not a valid Excel or CSV file." }, { status: 400, headers: NO_STORE });
    }

    // Territory: a non-top admin / supervisor may only edit contacts in their own area.
    let scope = null;
    const role = normalizeRole(session.user.role);
    if (isSupervisorRole(session)) scope = supervisorScopeFilter(session.user, "c");
    else if (role !== ROLES.SUPER_ADMIN && role !== ROLES.STATE_ADMIN) scope = scopeFilterSync(session.user, "c");

    const parsed = await parseImportEdit(rows, scope);
    if (parsed.error) return NextResponse.json({ message: parsed.error }, { status: 400, headers: NO_STORE });

    if (!dryRun) {
      // Deliberate "[clear]" operations must be confirmed explicitly (the preview shows the
      // count and a checkbox) — enforced here, not only in the UI.
      if (parsed.summary.fields_cleared > 0 && form.get("confirm_clear") !== "1") {
        return NextResponse.json({
          message: `This file would empty ${parsed.summary.fields_cleared} field${parsed.summary.fields_cleared === 1 ? "" : "s"} with [clear]. Confirm the clear operation to continue — nothing was changed.`,
          needs_confirm_clear: true, fields_cleared: parsed.summary.fields_cleared,
        }, { status: 409, headers: NO_STORE });
      }
      await applyImportEdit(parsed, session);
      await logAudit(session, {
        action: "contact.import_edit", entityType: "contact", entityId: null,
        details: { file: file.name, ...parsed.summary, contact_ids: parsed.rows.filter((r) => r.status === "updated").map((r) => r.contact_id).slice(0, 500) },
      });
    }

    const out = parsed.rows.slice(0, PREVIEW_ROWS).map((r) => ({
      row: r.row, status: r.status, contact_id: r.contact_id, name: r.name, changes: r.changes, errors: r.errors,
    }));
    return NextResponse.json({
      dry_run: dryRun,
      summary: parsed.summary,
      identifier: parsed.identifier,
      columns: parsed.columns,
      ignored_columns: parsed.ignoredColumns || [],
      rows: out,
      truncated: parsed.rows.length > PREVIEW_ROWS,
    }, { headers: NO_STORE });
  } catch (err) {
    console.error("[contacts] import-edit:", err?.message || err);
    return NextResponse.json({ message: "Import Edit failed.", detail: err?.sqlMessage || err?.message || null }, { status: 500, headers: NO_STORE });
  }
}
