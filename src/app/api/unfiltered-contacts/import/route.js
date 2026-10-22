import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import * as XLSX from "xlsx";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { logAudit } from "@/lib/audit";
import { ensureUnfilteredSchema, parseUnfilteredSheet, importUnfiltered } from "@/lib/unfilteredContacts";

// Unfiltered Contact — Excel/CSV bulk import. Writes ONLY to unfiltered_contacts;
// the contacts table is read solely to skip numbers that are already a Contact.
// Phone Number is mandatory and validated here (the browser pre-check is only a
// convenience); duplicates (in file / in Unfiltered / in Contacts) are skipped.
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!(await pageAllowed(session, "unfiltered_contacts", session && isAdmin(session)))) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    await ensureUnfilteredSchema();

    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ message: "No file uploaded" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ message: "File is too large (max 15 MB)." }, { status: 400 });

    let rows;
    try {
      const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
      // Raw cell values: a number cell stays a JS number (String() of an integer
      // never uses exponent form), text cells keep any "+91" / leading "0".
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    } catch {
      return NextResponse.json({ message: "Could not read the file. Use .xlsx, .xls, or .csv." }, { status: 400 });
    }
    if (rows.length < 2) return NextResponse.json({ message: "Sheet has no data rows." }, { status: 400 });

    const parsed = await parseUnfilteredSheet(rows);
    if (parsed.error) return NextResponse.json({ message: parsed.error }, { status: 400 });
    if (parsed.total === 0) return NextResponse.json({ message: "Sheet has no data rows." }, { status: 400 });

    const result = await importUnfiltered({ parsed, fileName: file.name, userId: session.user.id });
    await logAudit(session, {
      action: "unfiltered_contacts.import", entityType: "unfiltered_import_batch", entityId: result.batch_id,
      details: { file: file.name, total: result.total_rows, imported: result.added, duplicates: result.duplicates, invalid: result.invalid },
    }).catch(() => {});
    return NextResponse.json(result);
  } catch (err) {
    if (err?.status === 409) return NextResponse.json({ message: err.message }, { status: 409 });
    console.error("unfiltered-contacts import error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
